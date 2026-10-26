package siege

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"sync"
	"time"
)

// HTTP serves the workspace API behind Auro membership and CSRF middleware.
type HTTP struct {
	Service *Service
	mu      sync.Mutex
	windows map[string]struct {
		At    time.Time
		Count int
	}
}

type ownerKey struct{}

// WithOwner attaches the requesting member to the context.
func WithOwner(ctx context.Context, owner Owner) context.Context {
	return context.WithValue(ctx, ownerKey{}, owner)
}

// OwnerFromContext returns the member attached by WithOwner.
func OwnerFromContext(ctx context.Context) (Owner, bool) {
	owner, ok := ctx.Value(ownerKey{}).(Owner)
	return owner, ok && validRequest(owner.WorkspaceID) && validRequest(owner.UserID)
}

func (h *HTTP) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/siege/status", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"mode": h.Service.Mode, "ready": h.Service.Ready, "rulesVersion": RulesVersion, "parts": []string{"blade", "hammer", "cannon", "wheel", "shield", "structure"}})
	})
	mux.HandleFunc("POST /api/siege/sessions", h.create)
	mux.HandleFunc("GET /api/siege/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := OwnerFromContext(r.Context())
		if !ok {
			fail(w, problem("unauthenticated", 401))
			return
		}
		session, err := h.Service.Read(r.PathValue("id"), owner)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, session.public())
	})
	mux.HandleFunc("POST /api/siege/sessions/{id}/recognitions", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			RequestID string  `json:"requestId"`
			Drawing   Drawing `json:"drawing"`
		}
		if err := readBody(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		owner, ok := OwnerFromContext(r.Context())
		if !ok {
			fail(w, problem("unauthenticated", 401))
			return
		}
		view, err := h.Service.Recognize(r.Context(), r.PathValue("id"), owner, in.RequestID, in.Drawing)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, view)
	})
	mux.HandleFunc("GET /api/siege/sessions/{id}/recognitions/{requestId}", func(w http.ResponseWriter, r *http.Request) {
		owner, ok := OwnerFromContext(r.Context())
		if !ok {
			fail(w, problem("unauthenticated", 401))
			return
		}
		view, err := h.Service.Receipt(r.PathValue("id"), owner, r.PathValue("requestId"))
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, view)
	})
	mux.HandleFunc("POST /api/siege/sessions/{id}/blueprints", func(w http.ResponseWriter, r *http.Request) {
		var in SaveInput
		if err := readBody(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		owner, ok := OwnerFromContext(r.Context())
		if !ok {
			fail(w, problem("unauthenticated", 401))
			return
		}
		session, err := h.Service.Save(r.PathValue("id"), owner, in)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 200, session.public())
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := OwnerFromContext(r.Context()); !ok {
			fail(w, problem("unauthorized", 401))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == "POST" {
			media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || media != "application/json" {
				fail(w, problem("invalid_input", 415))
				return
			}
			if !h.allow(r) {
				fail(w, problem("rate_limited", 429))
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (h *HTTP) allow(r *http.Request) bool {
	owner, _ := OwnerFromContext(r.Context())
	key := owner.Hash()
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.windows == nil {
		h.windows = map[string]struct {
			At    time.Time
			Count int
		}{}
	}
	now := time.Now()
	for key, v := range h.windows {
		if now.Sub(v.At) > time.Minute {
			delete(h.windows, key)
		}
	}
	v := h.windows[key]
	if v.At.IsZero() {
		if len(h.windows) >= 4096 {
			return false
		}
		v.At = now
	}
	if v.Count >= 30 {
		return false
	}
	v.Count++
	h.windows[key] = v
	return true
}

func (h *HTTP) create(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RequestID string `json:"requestId"`
	}
	if err := readBody(w, r, &in); err != nil {
		fail(w, err)
		return
	}
	owner, ok := OwnerFromContext(r.Context())
	if !ok {
		fail(w, problem("unauthenticated", 401))
		return
	}
	session, err := h.Service.Create(owner, in.RequestID)
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 201, session.public())
}

func readBody(w http.ResponseWriter, r *http.Request, out any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return problem("invalid_input", 400)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return problem("invalid_input", 400)
	}
	return nil
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, err error) {
	var p *Problem
	if errors.As(err, &p) {
		respond(w, p.Status, map[string]string{"code": p.Code})
	} else {
		respond(w, 500, map[string]string{"code": "storage_unavailable"})
	}
}
