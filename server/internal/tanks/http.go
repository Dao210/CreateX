package tanks

import (
	"encoding/json"
	"errors"
	"github.com/auro-ai/auro/server/internal/mcpadmin"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/google/uuid"
)

const maxBody = 64 * 1024

type HTTP struct {
	Service        *Service
	AllowedOrigins []string
	Control        mcpadmin.Controller
}

func send(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func failure(w http.ResponseWriter, err error) {
	p := asProblem(err)
	send(w, p.Status, map[string]any{"requestId": uuid.NewString(), "error": p})
}
func asProblem(err error) *Problem {
	var p *Problem
	if errors.As(err, &p) {
		return p
	}
	return &Problem{Code: "service_unavailable", Message: "Tank service is temporarily unavailable.", Status: 503}
}
func readInput(w http.ResponseWriter, r *http.Request, out any) error {
	media, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if e != nil || media != "application/json" {
		return problem("unsupported_media_type", 415)
	}
	raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if e != nil {
		var limit *http.MaxBytesError
		if errors.As(e, &limit) {
			return problem("payload_too_large", 413)
		}
		return problem("invalid_request", 400)
	}
	if e = StrictDecode(raw, out); e != nil {
		return problem("invalid_request", 400)
	}
	return nil
}
func (h *HTTP) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/tanks/v1/catalog", func(w http.ResponseWriter, r *http.Request) { send(w, 200, json.RawMessage(catalogJSON)) })
	mux.HandleFunc("POST /api/tanks/v1/characters/validate", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Draft Draft `json:"draft"`
		}
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		send(w, 200, Validate(in.Draft, "custom"))
	})
	mux.HandleFunc("GET /api/tanks/v1/characters", func(w http.ResponseWriter, r *http.Request) {
		a, _ := actorFromContext(r.Context())
		items, e := h.Service.List(r.Context(), a)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, map[string]any{"characters": items})
	})
	mux.HandleFunc("POST /api/tanks/v1/characters", func(w http.ResponseWriter, r *http.Request) {
		var in SaveInput
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		c, e := h.Service.Save(r.Context(), a, in)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, c)
	})
	mux.HandleFunc("GET /api/tanks/v1/characters/{id}", func(w http.ResponseWriter, r *http.Request) {
		revision := 0
		if v := r.URL.Query().Get("revision"); v != "" {
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 || n > 50 {
				failure(w, problem("invalid_request", 400))
				return
			}
			revision = n
		}
		a, _ := actorFromContext(r.Context())
		c, e := h.Service.GetCharacter(r.Context(), a, r.PathValue("id"), revision)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, c)
	})
	mux.HandleFunc("POST /api/tanks/v1/compatibility", func(w http.ResponseWriter, r *http.Request) {
		var in SessionInput
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		c, m, e := h.Service.Compatibility(r.Context(), a, in)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, map[string]any{"compatible": true, "characterId": c.ID, "revision": c.Revision, "contentHash": c.ContentHash, "map": m})
	})
	mux.HandleFunc("POST /api/tanks/v1/sessions", func(w http.ResponseWriter, r *http.Request) {
		var in SessionInput
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		s, e := h.Service.CreateSession(r.Context(), a, in)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, s)
	})
	mux.HandleFunc("GET /api/tanks/v1/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		a, _ := actorFromContext(r.Context())
		s, e := h.Service.GetSession(r.Context(), a, r.PathValue("id"))
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, s)
	})
	mux.HandleFunc("/api/tanks/mcp", h.mcp)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if _, ok := actorFromContext(r.Context()); !ok {
			failure(w, problem("unauthenticated", 401))
			return
		}
		mux.ServeHTTP(w, r)
	})
}
