package service

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// TestIsDuplicatePendingTaskErr locks the driver-code detection (#5914): only a
// 23505 on either pending-task index name used during the v1/v2 rolling-deploy
// window is a benign duplicate-pending-task race. A different unique constraint
// (e.g. the agent name) or a plain error must not be mistaken for it, and the
// wrapped sentinel must remain detectable via errors.Is by callers. This runs
// without a database.
func TestIsDuplicatePendingTaskErr(t *testing.T) {
	for _, indexName := range []string{
		"idx_one_pending_task_per_issue_agent",
		"idx_one_pending_task_per_issue_agent_v2",
	} {
		dup := &pgconn.PgError{Code: "23505", ConstraintName: indexName}
		if !isDuplicatePendingTaskErr(dup) {
			t.Errorf("expected pending-task index %q to be recognized", indexName)
		}
	}
	if isDuplicatePendingTaskErr(&pgconn.PgError{Code: "23505", ConstraintName: "agent_workspace_name_unique"}) {
		t.Fatal("a different unique constraint must not be treated as a duplicate pending task")
	}
	if isDuplicatePendingTaskErr(&pgconn.PgError{Code: "40001", ConstraintName: "idx_one_pending_task_per_issue_agent_v2"}) {
		t.Fatal("a non-unique-violation SQLSTATE must not be treated as a duplicate pending task")
	}
	if isDuplicatePendingTaskErr(errors.New("boom")) {
		t.Fatal("a non-pg error must not be treated as a duplicate pending task")
	}

	wrapped := fmt.Errorf("%w: duplicate pending task", ErrDuplicatePendingTask)
	if !errors.Is(wrapped, ErrDuplicatePendingTask) {
		t.Fatal("the wrapped sentinel must stay detectable via errors.Is")
	}
}
