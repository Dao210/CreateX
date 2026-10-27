package main

import (
	"net/http"

	"github.com/auro-ai/auro/server/internal/gameprogress"
	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/util"
)

// gameProgressActor attaches the workspace member resolved by
// RequireWorkspaceMember to the personal progress store. Progress is keyed by
// the pair, so a token can never read another member's records.
func gameProgressActor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workspaceID := middleware.WorkspaceIDFromContext(r.Context())
		member, ok := middleware.MemberFromContext(r.Context())
		if !ok || workspaceID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"code":"unauthenticated"}`))
			return
		}
		actor := gameprogress.Actor{WorkspaceID: workspaceID, UserID: util.UUIDToString(member.UserID)}
		next.ServeHTTP(w, r.WithContext(gameprogress.WithActor(r.Context(), actor)))
	})
}
