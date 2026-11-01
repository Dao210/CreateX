package handler

import (
	"github.com/auro-ai/auro/server/internal/issuestatus"
)

// issueStatusCatalog is the querier catalog reads go through. Defaults to
// Queries; tests substitute a counting wrapper.
func (h *Handler) issueStatusCatalog() issuestatus.Querier {
	if h.IssueStatusCatalog != nil {
		return h.IssueStatusCatalog
	}
	return h.Queries
}
