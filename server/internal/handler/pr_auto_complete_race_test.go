package handler

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"
)

// hookedTxStarter runs hook before starting a transaction, to schedule work
// inside a handler's decision→write window.
type hookedTxStarter struct {
	base txStarter
	hook func() error
}

func (h hookedTxStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	if err := h.hook(); err != nil {
		return nil, err
	}
	return h.base.Begin(ctx)
}

// fireTimedPRWebhook delivers a pull_request event that closes identifier,
// with an explicit updated_at.
func fireTimedPRWebhook(t *testing.T, inst int64, identifier, state, timestamp string) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"action":       "edited",
		"installation": map[string]any{"id": inst},
		"repository":   map[string]any{"name": "widget", "owner": map[string]any{"login": "acme"}},
		"pull_request": map[string]any{"number": 1, "html_url": "https://github.com/acme/widget/pull/1", "title": "Closes " + identifier, "state": state, "merged": state == "closed", "created_at": "2026-09-22T00:00:00Z", "updated_at": timestamp, "head": map[string]any{"ref": "fix/a"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	testHandler.handlePullRequestEvent(context.Background(), raw)
}
