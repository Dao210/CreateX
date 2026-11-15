package main

import (
	"github.com/auro-ai/auro/server/internal/ctf"
	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/util"
	"net/http"
)

func ctfActor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		member, ok := middleware.MemberFromContext(r.Context())
		ws := middleware.WorkspaceIDFromContext(r.Context())
		if !ok || ws == "" {
			http.Error(w, `{"error":"unauthenticated"}`, 401)
			return
		}
		next.ServeHTTP(w, r.WithContext(ctf.WithActor(r.Context(), ctf.Actor{WorkspaceID: ws, UserID: util.UUIDToString(member.UserID)})))
	})
}
