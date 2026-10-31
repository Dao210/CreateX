// Package life exposes read-only snapshots of the TypeScript-owned simulation.
package life

import (
	"context"
	"errors"
	"net/http"

	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/util"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Reader interface {
	GetLifeSnapshot(context.Context, pgtype.UUID) ([]byte, error)
}

func Handler(reader Reader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := middleware.MemberFromContext(r.Context()); !ok {
			http.Error(w, "unauthenticated", http.StatusUnauthorized)
			return
		}
		serveSnapshot(w, r, reader, middleware.WorkspaceIDFromContext(r.Context()))
	}
}

func serveSnapshot(w http.ResponseWriter, r *http.Request, reader Reader, workspaceID string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "application/json")
	id, err := util.ParseUUID(workspaceID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"invalid_workspace"}`))
		return
	}
	// One SQL statement gives agents, resources, actions and events the same MVCC snapshot.
	raw, err := reader.GetLifeSnapshot(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = w.Write([]byte(`{"world":null,"agents":[],"resources":[],"actions":[],"events":[]}`))
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"code":"life_unavailable"}`))
		return
	}
	_, _ = w.Write(raw)
}
