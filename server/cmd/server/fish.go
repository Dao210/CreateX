package main

import (
	"net/http"

	"github.com/auro-ai/auro/server/internal/fish"
	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/util"
)

func fishActor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workspaceID := middleware.WorkspaceIDFromContext(r.Context())
		member, ok := middleware.MemberFromContext(r.Context())
		if !ok || workspaceID == "" {
			http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		a := fish.Actor{WorkspaceID: workspaceID, UserID: util.UUIDToString(member.UserID)}
		next.ServeHTTP(w, r.WithContext(fish.WithActor(r.Context(), a)))
	})
}
