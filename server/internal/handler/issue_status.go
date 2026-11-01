package handler

import (
	"context"

	"github.com/auro-ai/auro/server/internal/issuestatus"
	"github.com/jackc/pgx/v5/pgtype"
)

// Issue status catalog API (MUL-6243).
//
// Reading the catalog is open to any workspace member — every client needs it
// to render a status. Mutating it is owner/admin only: a status is workflow
// configuration shared by the whole workspace, and creating one changes what
// agents can be told to do.

// terminalIssueStatusKeys resolves the concrete status keys whose categories
// carry terminal behavior. Callers pass the result into indexed status
// predicates instead of resolving the category once per issue row.
func (h *Handler) terminalIssueStatusKeys(ctx context.Context, workspaceID pgtype.UUID) ([]string, error) {
	return issuestatus.ExpandCategories(ctx, h.Queries, workspaceID, []string{
		issuestatus.CategoryDone,
		issuestatus.CategoryClosed,
	})
}
