package gameadmin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"

	"github.com/auro-ai/auro/server/internal/adminauth"
	"github.com/auro-ai/auro/server/internal/middleware"
)

func send(w http.ResponseWriter, status int, out any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(out)
}
func fail(w http.ResponseWriter, err error) {
	status, code := 503, "game_policy_unavailable"
	switch {
	case errors.Is(err, adminauth.ErrForbidden):
		status, code = 403, "admin_forbidden"
	case errors.Is(err, ErrInvalid):
		status, code = 400, ErrInvalid.Error()
	case errors.Is(err, ErrNotFound):
		status, code = 404, ErrNotFound.Error()
	case errors.Is(err, ErrConflict):
		status, code = 409, ErrConflict.Error()
	default:
		slog.Error("Game policy request failed", "error", err)
	}
	send(w, status, map[string]string{"code": code, "error": code})
}
func readPolicy(w http.ResponseWriter, r *http.Request) (PolicyInput, bool) {
	var in PolicyInput
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		send(w, 415, map[string]string{"code": "unsupported_media_type"})
		return in, false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil {
		fail(w, ErrInvalid)
		return in, false
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		fail(w, ErrInvalid)
		return in, false
	}
	return in, true
}

func (s *Service) AdminHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/admin/games", func(w http.ResponseWriter, r *http.Request) {
		items, err := s.Overview(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		send(w, 200, map[string]any{"games": items})
	})
	mux.HandleFunc("GET /api/admin/games/worlds", func(w http.ResponseWriter, r *http.Request) {
		page, err := s.Worlds(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("cursor"))
		if err != nil {
			fail(w, err)
			return
		}
		send(w, 200, page)
	})
	mux.HandleFunc("PUT /api/admin/games/{gameID}/policy", func(w http.ResponseWriter, r *http.Request) {
		in, ok := readPolicy(w, r)
		if !ok {
			return
		}
		policy, err := s.Update(r.Context(), r.Header.Get("X-User-ID"), r.PathValue("gameID"), in)
		if err != nil {
			fail(w, err)
			return
		}
		send(w, 200, policy)
	})
	mux.HandleFunc("POST /api/admin/games/{gameID}/preview", func(w http.ResponseWriter, r *http.Request) {
		in, ok := readPolicy(w, r)
		if !ok {
			return
		}
		counts, err := s.Preview(r.Context(), r.PathValue("gameID"), in)
		if err != nil {
			fail(w, err)
			return
		}
		send(w, 200, counts)
	})
	mux.HandleFunc("GET /api/admin/games/{gameID}/activity", func(w http.ResponseWriter, r *http.Request) {
		page, err := s.Activity(r.Context(), r.PathValue("gameID"), r.URL.Query().Get("cursor"))
		if err != nil {
			fail(w, err)
			return
		}
		send(w, 200, page)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-User-ID") == "" {
			send(w, 401, map[string]string{"code": "unauthenticated"})
			return
		}
		if r.Header.Get("X-Actor-Source") != "" {
			fail(w, adminauth.ErrForbidden)
			return
		}
		allowed, err := s.Auth.IsAdmin(r.Context(), r.Header.Get("X-User-ID"))
		if err != nil {
			fail(w, err)
			return
		}
		if !allowed {
			fail(w, adminauth.ErrForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *Service) MemberHandler(w http.ResponseWriter, r *http.Request) {
	if _, ok := middleware.MemberFromContext(r.Context()); !ok {
		send(w, 401, map[string]string{"code": "unauthenticated"})
		return
	}
	wid := middleware.WorkspaceIDFromContext(r.Context())
	items := []Effective{}
	for _, id := range GameIDs {
		out, err := s.Effective(r.Context(), wid, id)
		if err != nil {
			fail(w, err)
			return
		}
		items = append(items, out)
	}
	send(w, 200, map[string]any{"workspaceId": wid, "games": items})
}

// Guard wraps HTTP and MCP transports after membership is resolved.
func (s *Service) Guard(id string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := middleware.MemberFromContext(r.Context()); !ok {
			send(w, 401, map[string]string{"code": "unauthenticated"})
			return
		}
		out, err := s.Effective(r.Context(), middleware.WorkspaceIDFromContext(r.Context()), id)
		if err != nil {
			fail(w, err)
			return
		}
		if !out.Available {
			send(w, 403, map[string]string{"code": "game_unavailable", "gameId": id, "reason": out.Reason})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ProgressGuard limits writes per game and passes the allowed set to aggregate reads.
func (s *Service) ProgressGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := middleware.MemberFromContext(r.Context()); !ok {
			send(w, 401, map[string]string{"code": "unauthenticated"})
			return
		}
		allowed := map[string]bool{}
		for _, id := range []string{"siege", "tanks"} {
			out, err := s.Effective(r.Context(), middleware.WorkspaceIDFromContext(r.Context()), id)
			if err != nil {
				fail(w, err)
				return
			}
			allowed[id] = out.Available
		}
		if r.Method != http.MethodGet {
			id := strings.TrimPrefix(r.URL.Path, "/api/game-progress/")
			if !allowed[id] {
				send(w, 403, map[string]string{"code": "game_unavailable"})
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), allowedGamesKey{}, allowed)))
	})
}

type allowedGamesKey struct{}

func ProgressAllowed(ctx context.Context, id string) bool {
	allowed, ok := ctx.Value(allowedGamesKey{}).(map[string]bool)
	return !ok || allowed[id]
}
