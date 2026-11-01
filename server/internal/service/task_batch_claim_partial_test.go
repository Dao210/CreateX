package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// failNthBeginTxStarter fails the Nth Begin so a specific ClaimTask inside the
// batch loop errors AFTER earlier ones have committed.
type failNthBeginTxStarter struct {
	inner  TxStarter
	failOn int
	mu     sync.Mutex
	count  int
}

func (s *failNthBeginTxStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	s.mu.Lock()
	s.count++
	n := s.count
	s.mu.Unlock()
	if n == s.failOn {
		return nil, fmt.Errorf("injected begin failure #%d", n)
	}
	return s.inner.Begin(ctx)
}

// candidateFailDBTX passes every statement through EXCEPT the batch candidate
// SELECT, which it fails — simulating a candidate query error after step-2
// reclaims have already committed.
type candidateFailDBTX struct{ inner db.DBTX }

func (f candidateFailDBTX) Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	return f.inner.Exec(ctx, sql, args...)
}

func (f candidateFailDBTX) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	if strings.Contains(sql, "ListQueuedClaimCandidatesByRuntimes") {
		return nil, fmt.Errorf("injected candidate query failure")
	}
	return f.inner.Query(ctx, sql, args...)
}

func (f candidateFailDBTX) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	return f.inner.QueryRow(ctx, sql, args...)
}

// TestClaimTasksForRuntimes_PartialSuccessOnSecondAgentClaimFailure is the
// MUL-4257 review regression: ClaimTask runs per agent in its own transaction,
// so when a later agent's claim fails the already-committed (dispatched) tasks
// must be RETURNED, not dropped with an error. Dropping them would 500 the
// handler and make the daemon HTTP-fall-back and double-claim the same slots.
func TestClaimTasksForRuntimes_PartialSuccessOnSecondAgentClaimFailure(t *testing.T) {
	ctx := context.Background()
	pool := newTaskClaimRacePool(t)
	tx := &failNthBeginTxStarter{inner: pool, failOn: 2} // 1st agent claims, 2nd errors
	svc := NewTaskService(db.New(pool), tx, nil, events.New())

	rt1, rt2 := batchClaimFixture(t, ctx, pool)
	ids := []pgtype.UUID{util.MustParseUUID(rt1), util.MustParseUUID(rt2)}

	claimed, err := svc.ClaimTasksForRuntimes(ctx, ids, 5)
	if err != nil {
		t.Fatalf("expected partial success (nil error), got %v", err)
	}
	if len(claimed) != 1 {
		t.Fatalf("claimed %d tasks, want 1 (the first agent's committed task, not dropped)", len(claimed))
	}

	// The one returned task must actually be dispatched in the DB (committed),
	// proving we returned a real claim rather than a phantom.
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM agent_task_queue WHERE id = $1`, util.UUIDToString(claimed[0].ID)).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "dispatched" {
		t.Fatalf("returned task status = %s, want dispatched", status)
	}
}
