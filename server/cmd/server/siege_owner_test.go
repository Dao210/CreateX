package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/siege"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
)

// TestSiegeOwnerGlue verifies the workspace authentication boundary.
func TestSiegeOwnerGlue(t *testing.T) {
	memberID := uuid.MustParse("6f1a1f9c-3c4a-4c1a-9b8e-2f1d0b6a7c55")
	const workspaceID = "0d1f4a8e-9c2b-4a71-8f3d-5b6e7c8d9a01"

	memberCtx := func(t *testing.T, r *http.Request, workspace string) *http.Request {
		t.Helper()
		member := db.Member{UserID: pgtype.UUID{Bytes: memberID, Valid: true}}
		return r.WithContext(middleware.SetMemberContext(r.Context(), workspace, member))
	}

	t.Run("workspace member becomes the game owner", func(t *testing.T) {
		var got siege.Owner
		rec := httptest.NewRecorder()
		req := memberCtx(t, httptest.NewRequest(http.MethodGet, "/api/siege/status", nil), workspaceID)

		siegeOwner(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			owner, ok := siege.OwnerFromContext(r.Context())
			if !ok {
				t.Fatal("handler reached without an owner in context")
			}
			got = owner
			w.WriteHeader(http.StatusNoContent)
		})).ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
		if got.WorkspaceID != workspaceID {
			t.Errorf("WorkspaceID = %q, want %q", got.WorkspaceID, workspaceID)
		}
		if got.UserID != memberID.String() {
			t.Errorf("UserID = %q, want %q", got.UserID, memberID.String())
		}
	})

	// Both shapes that lack half the identity must be refused before the game
	// handler runs: an anonymous request, and the half-filled context a future
	// refactor of the workspace middleware could produce.
	cases := []struct {
		name string
		ctx  func(t *testing.T, r *http.Request) *http.Request
	}{
		{name: "anonymous", ctx: func(t *testing.T, r *http.Request) *http.Request { return r }},
		{
			name: "member without workspace",
			ctx: func(t *testing.T, r *http.Request) *http.Request {
				return memberCtx(t, r, "")
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			rec := httptest.NewRecorder()
			req := tc.ctx(t, httptest.NewRequest(http.MethodPost, "/api/siege/sessions", nil))

			siegeOwner(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true })).
				ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
			if called {
				t.Error("game handler ran for a request with no resolved owner")
			}
			if body := rec.Body.String(); body != `{"code":"unauthenticated"}` {
				t.Errorf("body = %s, want the client's unauthenticated code", body)
			}
		})
	}
}
