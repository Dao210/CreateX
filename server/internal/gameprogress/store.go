package gameprogress

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Stored struct {
	Payload   []byte
	UpdatedAt time.Time
}

type Store interface {
	Load(ctx context.Context, workspaceID, userID string) (map[string]Stored, error)
	Merge(ctx context.Context, workspaceID, userID, game string, merge func([]byte) ([]byte, error)) (Stored, error)
}

type PGStore struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *PGStore { return &PGStore{Pool: pool} }

func (s *PGStore) Load(ctx context.Context, workspaceID, userID string) (map[string]Stored, error) {
	rows, err := s.Pool.Query(ctx, `
		select game, payload, updated_at from game_progress
		where workspace_id = $1::uuid and user_id = $2::uuid`, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]Stored)
	for rows.Next() {
		var game string
		var stored Stored
		if err = rows.Scan(&game, &stored.Payload, &stored.UpdatedAt); err != nil {
			return nil, err
		}
		out[game] = stored
	}
	return out, rows.Err()
}

func (s *PGStore) Merge(ctx context.Context, workspaceID, userID, game string, merge func([]byte) ([]byte, error)) (Stored, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Stored{}, err
	}
	defer tx.Rollback(ctx)
	// The workspace/member lock fences this write against workspace deletion.
	var id string
	err = tx.QueryRow(ctx, `
		select w.id from workspace w
		join member m on m.workspace_id = w.id
		join "user" u on u.id = m.user_id
		where w.id = $1::uuid and m.user_id = $2::uuid
		for key share of w, m, u`, workspaceID, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Stored{}, problem("not_found", 404)
	}
	if err != nil {
		return Stored{}, err
	}
	// Serialize one member's writes per game so two devices cannot both read
	// the same snapshot and overwrite each other's higher values.
	if _, err = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1))`, workspaceID+"|"+userID+"|"+game); err != nil {
		return Stored{}, err
	}
	var current []byte
	err = tx.QueryRow(ctx, `
		select payload from game_progress
		where workspace_id = $1::uuid and user_id = $2::uuid and game = $3
		for update`, workspaceID, userID, game).Scan(&current)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Stored{}, err
	}
	merged, err := merge(current)
	if err != nil {
		return Stored{}, err
	}
	var stored Stored
	stored.Payload = merged
	err = tx.QueryRow(ctx, `
		insert into game_progress (workspace_id, user_id, game, payload, updated_at)
		values ($1::uuid, $2::uuid, $3, $4::jsonb, now())
		on conflict (workspace_id, user_id, game) do update
		set payload = excluded.payload, updated_at = now()
		returning updated_at`, workspaceID, userID, game, string(merged)).Scan(&stored.UpdatedAt)
	if err != nil {
		return Stored{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Stored{}, err
	}
	return stored, nil
}
