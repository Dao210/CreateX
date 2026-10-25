package siege

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgxNoRows is pgx.ErrNoRows under a local name so both call sites read the
// same as the file store's os.IsNotExist checks.
var pgxNoRows = pgx.ErrNoRows

// pgLockNamespace keeps siege advisory locks from colliding with any other
// advisory-lock user in the same database. Paired with hashtext(session id),
// which makes the lock per session rather than per table.
const pgLockNamespace = 7743

// pgStore is the workspace-scoped backend used by the main server.
//
// Sessions live in one jsonb document per row; see migration 564 for why the
// blueprint list is not normalized. Concurrency uses a connection-scoped
// advisory lock, which gives the same "one writer per session, everyone else
// gets service_busy" behaviour as the file store's mutex, and additionally
// excludes other server processes.
type pgStore struct {
	pool *pgxpool.Pool
}

// OpenPGStore returns a PostgreSQL-backed Store. The pool is owned by the
// caller; Close does not shut it down.
func OpenPGStore(pool *pgxpool.Pool) Store { return &pgStore{pool: pool} }

func (s *pgStore) Close() error { return nil }

func (s *pgStore) scan(data []byte) (*Session, error) {
	var session Session
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *pgStore) CreateSession(owner Owner, requestID string, build func() *Session) (*Session, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Idempotency first: a retried create must return the original session,
	// exactly like the file store's CreateRequest scan.
	var existing []byte
	err = tx.QueryRow(ctx, `
		select payload from siege_session
		where workspace_id = $1::uuid and user_id = $2::uuid
		  and payload->>'createRequest' = $3
		limit 1`, owner.WorkspaceID, owner.UserID, requestID).Scan(&existing)
	if err == nil {
		return s.scan(existing)
	}
	if !errors.Is(err, pgxNoRows) {
		return nil, err
	}

	var total, mine int
	if err = tx.QueryRow(ctx, `select count(*) from siege_session`).Scan(&total); err != nil {
		return nil, err
	}
	if err = tx.QueryRow(ctx, `
		select count(*) from siege_session
		where workspace_id = $1::uuid and user_id = $2::uuid`,
		owner.WorkspaceID, owner.UserID).Scan(&mine); err != nil {
		return nil, err
	}
	if total >= maxSessionsTotal || mine >= maxSessionsPerOwner {
		return nil, problem("capacity_reached", 429)
	}

	session := build()
	payload, err := json.Marshal(session)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `
		insert into siege_session (id, workspace_id, user_id, version, payload)
		values ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb)`,
		session.ID, owner.WorkspaceID, owner.UserID, session.Version, string(payload)); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return session, nil
}

func (s *pgStore) ReadSession(id string, owner Owner) (*Session, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var payload []byte
	err := s.pool.QueryRow(ctx, `
		select payload from siege_session
		where id = $1::uuid and workspace_id = $2::uuid and user_id = $3::uuid`,
		id, owner.WorkspaceID, owner.UserID).Scan(&payload)
	if err != nil {
		if errors.Is(err, pgxNoRows) {
			return nil, problem("not_found", 404)
		}
		return nil, err
	}
	return s.scan(payload)
}

func (s *pgStore) LockSession(id string, owner Owner) (*Session, func(), error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return nil, nil, err
	}
	var locked bool
	err = conn.QueryRow(ctx,
		`select pg_try_advisory_lock($1, hashtext($2))`, pgLockNamespace, id).Scan(&locked)
	if err != nil || !locked {
		conn.Release()
		if err != nil {
			return nil, nil, err
		}
		return nil, nil, problem("service_busy", 429)
	}
	release := func() {
		releaseCtx, cancelRelease := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelRelease()
		_, _ = conn.Exec(releaseCtx, `select pg_advisory_unlock($1, hashtext($2))`, pgLockNamespace, id)
		conn.Release()
	}

	var payload []byte
	err = conn.QueryRow(ctx, `
		select payload from siege_session
		where id = $1::uuid and workspace_id = $2::uuid and user_id = $3::uuid`,
		id, owner.WorkspaceID, owner.UserID).Scan(&payload)
	if err != nil {
		release()
		if errors.Is(err, pgxNoRows) {
			return nil, nil, problem("not_found", 404)
		}
		return nil, nil, err
	}
	session, err := s.scan(payload)
	if err != nil {
		release()
		return nil, nil, err
	}
	return session, release, nil
}

func (s *pgStore) SaveSession(session *Session) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	payload, err := json.Marshal(session)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `
		update siege_session
		set payload = $2::jsonb, version = $3, updated_at = now()
		where id = $1::uuid`, session.ID, string(payload), session.Version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return problem("not_found", 404)
	}
	return nil
}

func (s *pgStore) ReserveBudget(owner Owner, limit int) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// The WHERE on the conflict branch makes an exhausted budget insert nothing
	// and update nothing, so RowsAffected distinguishes "consumed" from "over".
	//
	// The insert branch needs the same guard, expressed as a filtered select: a
	// budget of 0 means "no recognitions", and a bare VALUES insert would hand
	// out the first one for free. The day is bucketed in UTC because the file
	// store rolls over at UTC midnight; current_date would follow the database's
	// timezone instead, so the two backends would disagree about the boundary.
	tag, err := s.pool.Exec(ctx, `
		insert into siege_recognition_budget (workspace_id, user_id, day, count)
		select $1::uuid, $2::uuid, (now() at time zone 'utc')::date, 1
		where $3 > 0
		on conflict (workspace_id, user_id, day) do update
		set count = siege_recognition_budget.count + 1
		where siege_recognition_budget.count < $3`,
		owner.WorkspaceID, owner.UserID, limit)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return problem("recognition_budget", 429)
	}
	return nil
}
