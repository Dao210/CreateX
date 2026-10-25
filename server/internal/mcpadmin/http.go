package mcpadmin

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
)

type HTTP struct{ Service *Service }

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, e error) {
	status, code := http.StatusServiceUnavailable, "admin_service_unavailable"
	switch {
	case errors.Is(e, ErrForbidden):
		status, code = 403, ErrForbidden.Error()
	case errors.Is(e, ErrInvalid):
		status, code = 400, ErrInvalid.Error()
	case errors.Is(e, ErrNotFound):
		status, code = 404, ErrNotFound.Error()
	case errors.Is(e, ErrConflict):
		status, code = 409, ErrConflict.Error()
	default:
		slog.Error("MCP admin request failed", "error", e)
	}
	writeJSON(w, status, map[string]any{"error": code, "code": code})
}
func (h *HTTP) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/admin/access", func(w http.ResponseWriter, r *http.Request) {
		allowed, e := h.Service.IsAdmin(r.Context(), r.Header.Get("X-User-ID"))
		if e != nil {
			writeError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"isAdmin": allowed, "configured": h.Service.Configured()})
	})
	managed := http.NewServeMux()
	managed.HandleFunc("GET /api/admin/mcp", func(w http.ResponseWriter, r *http.Request) {
		items, e := h.Service.Overview(r.Context())
		if e != nil {
			writeError(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"services": items})
	})
	managed.HandleFunc("PUT /api/admin/mcp/{serviceID}/policy", func(w http.ResponseWriter, r *http.Request) {
		media, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if e != nil || media != "application/json" {
			writeJSON(w, 415, map[string]any{"error": "unsupported_media_type"})
			return
		}
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
		d.DisallowUnknownFields()
		var input PolicyInput
		if d.Decode(&input) != nil {
			writeError(w, ErrInvalid)
			return
		}
		var extra any
		if d.Decode(&extra) != io.EOF {
			writeError(w, ErrInvalid)
			return
		}
		policy, e := h.Service.UpdatePolicy(r.Context(), r.Header.Get("X-User-ID"), r.PathValue("serviceID"), input)
		if e != nil {
			writeError(w, e)
			return
		}
		writeJSON(w, 200, policy)
	})
	managed.HandleFunc("GET /api/admin/mcp/{serviceID}/activity", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		page, e := h.Service.Activity(r.Context(), r.PathValue("serviceID"), query.Get("tool"), query.Get("outcome"), query.Get("workspaceId"), query.Get("cursor"))
		if e != nil {
			writeError(w, e)
			return
		}
		writeJSON(w, 200, page)
	})
	mux.Handle("/api/admin/mcp", h.requireAdmin(managed))
	mux.Handle("/api/admin/mcp/", h.requireAdmin(managed))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Header.Get("X-User-ID") == "" {
			writeJSON(w, 401, map[string]any{"error": "unauthenticated"})
			return
		}
		// The outer Auth middleware strips caller-supplied actor headers and
		// stamps machine credentials. They never receive platform authority.
		if r.Header.Get("X-Actor-Source") != "" {
			writeError(w, ErrForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func (h *HTTP) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowed, e := h.Service.IsAdmin(r.Context(), r.Header.Get("X-User-ID"))
		if e != nil {
			writeError(w, e)
			return
		}
		if !allowed {
			writeError(w, ErrForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
