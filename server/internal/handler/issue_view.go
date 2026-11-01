package handler

import (
	"encoding/json"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
)

// Saved issue views (MUL-4796): server-backed filter definitions with
// display defaults. `query` is the shared identity of a view; `display`
// only seeds a member's first open. Both are opaque JSON to the server —
// interpretation lives in the client definition_version contract.

// issueViewBodyMaxBytes bounds every saved-view write. The query/display
// blobs are filter documents — real ones are a few KB; the cap is the
// abuse backstop, comfortably above any legitimate payload.
const issueViewBodyMaxBytes = 128 * 1024

var (
	validIssueViewScopeTypes        = []string{"workspace", "my", "project"}
	validIssueViewMyVariants        = []string{"assigned", "created", "involved", "any"}
	validIssueViewWorkspaceVariants = []string{"members", "agents"}
	validIssueViewVisibilities      = []string{"private", "workspace"}
)

// canReadIssueView: owner always; workspace-shared views for any member.
// (My-scope views are constrained to private by the DB CHECK, so they only
// ever match the owner branch.)
func canReadIssueView(v db.IssueView, userID pgtype.UUID) bool {
	return v.OwnerID == userID || v.Visibility == "workspace"
}

func isJSONObject(raw json.RawMessage) bool {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return false
	}
	// JSON null unmarshals into a nil map without error — reject it here
	// instead of letting the DB CHECK turn it into a 500.
	return m != nil
}
