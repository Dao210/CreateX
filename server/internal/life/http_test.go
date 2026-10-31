package life

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type readerFunc func(context.Context, pgtype.UUID) ([]byte, error)

func (f readerFunc) GetLifeSnapshot(ctx context.Context, id pgtype.UUID) ([]byte, error) {
	return f(ctx, id)
}

func TestSnapshotBoundary(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
	}{
		{"ok", nil, 200}, {"not_configured", pgx.ErrNoRows, 200}, {"database_unavailable", errors.New("secret connection string"), 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/life", nil)
			out := httptest.NewRecorder()
			reader := readerFunc(func(_ context.Context, id pgtype.UUID) ([]byte, error) {
				if !id.Valid {
					t.Fatal("missing workspace filter")
				}
				return []byte(`{"world":null}`), tc.err
			})
			serveSnapshot(out, req, reader, "a11fe000-0000-4000-8000-000000000001")
			if out.Code != tc.status {
				t.Fatalf("status=%d body=%s", out.Code, out.Body.String())
			}
			if out.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("snapshot must not be cached")
			}
			if tc.err != nil && tc.status == 503 && out.Body.String() != `{"code":"life_unavailable"}` {
				t.Fatal("internal error leaked")
			}
		})
	}
}

func TestSnapshotRejectsMissingMembership(t *testing.T) {
	out := httptest.NewRecorder()
	Handler(readerFunc(func(context.Context, pgtype.UUID) ([]byte, error) {
		t.Fatal("read without membership")
		return nil, nil
	})).ServeHTTP(out, httptest.NewRequest(http.MethodGet, "/api/life", nil))
	if out.Code != 401 {
		t.Fatalf("status=%d", out.Code)
	}
}
