package adminstats

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/auro-ai/auro/server/internal/adminauth"
)

func send(w http.ResponseWriter, status int, out any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(out)
}

func fail(w http.ResponseWriter, err error) {
	status, code := 503, "admin_stats_unavailable"
	switch {
	case errors.Is(err, adminauth.ErrForbidden):
		status, code = 403, "admin_forbidden"
	case errors.Is(err, ErrInvalid):
		status, code = 400, ErrInvalid.Error()
	default:
		slog.Error("Admin stats request failed", "error", err)
	}
	send(w, status, map[string]string{"code": code, "error": code})
}

func (s *Service) AdminHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/admin/stats/overview", func(w http.ResponseWriter, r *http.Request) {
		overview, err := s.Overview(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		send(w, 200, overview)
	})
	mux.HandleFunc("GET /api/admin/stats/trends", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		days := defaultTrendDays
		if raw := query.Get("days"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed <= 0 || parsed > maxTrendDays {
				fail(w, ErrInvalid)
				return
			}
			days = parsed
		}
		trends, err := s.Trends(r.Context(), days, query.Get("tz"))
		if err != nil {
			fail(w, err)
			return
		}
		send(w, 200, trends)
	})
	mux.HandleFunc("GET /api/admin/stats/breakdown", func(w http.ResponseWriter, r *http.Request) {
		breakdown, err := s.Breakdown(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		send(w, 200, breakdown)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-User-ID") == "" {
			send(w, 401, map[string]string{"code": "unauthenticated"})
			return
		}
		// Machine credentials (X-Actor-Source) never receive platform
		// authority, mirroring the mcpadmin/gameadmin gates.
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
