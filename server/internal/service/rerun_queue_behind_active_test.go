package service

import (
	"context"
	"testing"

	"github.com/auro-ai/auro/server/internal/events"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// rerunQueueFixture seeds the shared (workspace, agent, issue) trio and returns
// the service under test plus the agent's runtime id, which
// agent_task_queue.runtime_id needs (NOT NULL).
func rerunQueueFixture(t *testing.T) (svc *TaskService, pool *pgxpool.Pool, creatorID, agentID, issueID, runtimeID string) {
	t.Helper()
	pool = newResolveOriginatorPool(t)
	_, creatorID, agentID, issueID = seedAttributionFixture(t, pool)

	if err := pool.QueryRow(context.Background(), `SELECT runtime_id::text FROM agent WHERE id = $1`, agentID).Scan(&runtimeID); err != nil {
		t.Fatalf("read agent runtime: %v", err)
	}
	svc = &TaskService{Queries: db.New(pool), TxStarter: pool, Bus: events.New()}
	return svc, pool, creatorID, agentID, issueID, runtimeID
}

func seedRerunTask(t *testing.T, pool *pgxpool.Pool, agentID, runtimeID, issueID, status string) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO agent_task_queue (agent_id, runtime_id, status, priority)
		VALUES ($1, $2, $3, 0)
		RETURNING id
	`, agentID, runtimeID, status).Scan(&id); err != nil {
		t.Fatalf("insert %s task: %v", status, err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE id = $1`, id) })
	return id
}

func taskStatus(t *testing.T, pool *pgxpool.Pool, id pgtype.UUID) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM agent_task_queue WHERE id = $1`, id).Scan(&status); err != nil {
		t.Fatalf("read task status: %v", err)
	}
	return status
}
