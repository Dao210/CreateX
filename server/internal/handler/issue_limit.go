package handler

import (
	"errors"
	"net/http"

	"github.com/auro-ai/auro/server/internal/service"
)

func writeIssueLimitReached(w http.ResponseWriter, err error) bool {
	var limitErr *service.IssueLimitReachedError
	if !errors.As(err, &limitErr) {
		return false
	}
	writeJSON(w, http.StatusPaymentRequired, map[string]any{
		"code":            "issue_limit_reached",
		"error":           "workspace has reached its issue limit",
		"limit":           limitErr.Limit,
		"policy_revision": limitErr.PolicyRevision,
	})
	return true
}
