package service

import (
	"context"
	"strings"
	"testing"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type recoveryCatalogErrorDB struct {
	db.DBTX
	err error
}

func (d recoveryCatalogErrorDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "FROM issue_status") {
		return recoveryCatalogErrorRow{d.err}
	}
	return d.DBTX.QueryRow(ctx, sql, args...)
}

type recoveryCatalogErrorRow struct{ err error }

func (r recoveryCatalogErrorRow) Scan(...any) error { return r.err }

type delegatedFailureFixture struct {
	pool          *pgxpool.Pool
	workspaceID   string
	userID        string
	issueID       string
	workerIssue   string
	runtimeID     string
	coordinator   string
	worker        string
	sourceTrigger string
	sourceTask    string
}

func (f *delegatedFailureFixture) insertWorkerTask(t *testing.T, status, evidenceKind string, attempt, maxAttempts int32) pgtype.UUID {
	t.Helper()
	var taskID pgtype.UUID
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO agent_task_queue (
			agent_id, runtime_id, issue_id, status, priority, attempt, max_attempts,
			originator_user_id, accountable_user_id, originator_source,
			delegated_from_task_id, trigger_evidence_kind
		)
		VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $7, 'delegation', $8, NULLIF($9, ''))
		RETURNING id`, f.worker, f.runtimeID, f.workerIssue, status, attempt, maxAttempts, f.userID, f.sourceTask, evidenceKind).Scan(&taskID); err != nil {
		t.Fatalf("seed worker task: %v", err)
	}
	return taskID
}
