package main

import (
	"net/http"

	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/tanks"
	"github.com/auro-ai/auro/server/internal/util"
)

func tankActor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workspaceID := middleware.WorkspaceIDFromContext(r.Context())
		member, ok := middleware.MemberFromContext(r.Context())
		if !ok || workspaceID == "" {
			http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		a := tanks.Actor{WorkspaceID: workspaceID, UserID: util.UUIDToString(member.UserID)}
		next.ServeHTTP(w, r.WithContext(tanks.WithActor(r.Context(), a)))
	})
}
