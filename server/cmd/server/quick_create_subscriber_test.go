package main

import (
	"context"
	"strings"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Subscribing the quick-create requester moved OFF the completion path in
// MUL-5483. It now happens at issue-creation time in the shared
// delegated-subscriber rule, which resolves the human from
// origin_type='quick_create' + the origin task's originator_user_id — the same
// origin waterfall attribution uses. That behavior is covered by
// TestDelegatedSubscribe_QuickCreateKeepsDirectReason in
// delegated_subscriber_test.go, including the assertion that quick create keeps
// the direct 'creator' tier rather than the reduced delegated one.
//
// The failure-path test below stays here: "no issue created ⇒ no subscriber
// row" is a property of the quick-create completion flow itself and holds
// regardless of which layer writes the subscription.

func deleteInboxForTask(taskID pgtype.UUID) {
	testPool.Exec(context.Background(),
		`DELETE FROM inbox_item WHERE details->>'task_id' = $1::text`, taskID)
}

// failGetIssueByOriginDB delegates every statement to the real pool except the
// quick-create completion lookup, which it fails with a non-ErrNoRows error to
// simulate a transient DB fault on exactly that query. Everything else —
// including the inbox write the assertion depends on — still hits the real DB.
type failGetIssueByOriginDB struct {
	db.DBTX
	err error
}

func (f failGetIssueByOriginDB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	// sqlc keeps the `-- name: <Query>` header in the generated SQL constant,
	// so this matches that one query and nothing else.
	if strings.Contains(sql, "name: GetIssueByOrigin") {
		return errRow{err: f.err}
	}
	return f.DBTX.QueryRow(ctx, sql, args...)
}

// cancelOnGetIssueByOriginDB cancels the caller's context at the moment of the
// origin lookup and fails it with context.Canceled — the shape a cancelled or
// timed-out request actually produces, where every later use of that same
// context is doomed too.
type cancelOnGetIssueByOriginDB struct {
	db.DBTX
	cancel context.CancelFunc
}

func (f cancelOnGetIssueByOriginDB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	if strings.Contains(sql, "name: GetIssueByOrigin") {
		f.cancel()
		return errRow{err: context.Canceled}
	}
	return f.DBTX.QueryRow(ctx, sql, args...)
}

type errRow struct{ err error }

func (r errRow) Scan(...any) error { return r.err }
