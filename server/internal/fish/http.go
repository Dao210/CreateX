package fish

import (
	"encoding/json"
	"errors"
	"github.com/auro-ai/auro/server/internal/mcpadmin"
	"io"
	"mime"
	"net/http"
	"strconv"
)

const maxBody = 128 * 1024

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
func asProblem(err error) *Problem {
	var p *Problem
	if errors.As(err, &p) {
		return p
	}
	return &Problem{Code: "service_unavailable", Message: "Fish service is temporarily unavailable.", Status: 503}
}
func failure(w http.ResponseWriter, err error) {
	p := asProblem(err)
	send(w, p.Status, map[string]any{"error": p})
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
	mux.HandleFunc("GET /api/fish/v1/catalog", func(w http.ResponseWriter, r *http.Request) { send(w, 200, json.RawMessage(catalogJSON)) })
	mux.HandleFunc("POST /api/fish/v1/validate", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Draft Draft `json:"draft"`
		}
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		send(w, 200, Validate(in.Draft))
	})
	mux.HandleFunc("GET /api/fish/v1/fish", func(w http.ResponseWriter, r *http.Request) {
		a, _ := actorFromContext(r.Context())
		out, e := h.Service.List(r.Context(), a)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, map[string]any{"fish": out})
	})
	mux.HandleFunc("POST /api/fish/v1/fish", func(w http.ResponseWriter, r *http.Request) {
		var in SaveInput
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		out, e := h.Service.Save(r.Context(), a, in)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, out)
	})
	mux.HandleFunc("GET /api/fish/v1/fish/{id}", func(w http.ResponseWriter, r *http.Request) {
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
		out, e := h.Service.Get(r.Context(), a, r.PathValue("id"), revision)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, out)
	})
	mux.HandleFunc("POST /api/fish/v1/fish/{id}/archive", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			RequestID string `json:"requestId"`
			Archived  bool   `json:"archived"`
		}
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		out, e := h.Service.Archive(r.Context(), a, in.RequestID, r.PathValue("id"), in.Archived)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, out)
	})
	mux.HandleFunc("GET /api/fish/v1/ocean", func(w http.ResponseWriter, r *http.Request) {
		a, _ := actorFromContext(r.Context())
		out, e := h.Service.Ocean(r.Context(), a, r.URL.Query().Get("id"))
		if e != nil {
			failure(w, e)
			return
		}
		var ocean any = out
		if out.ID == "" {
			ocean = nil
		}
		send(w, 200, map[string]any{"ocean": ocean})
	})
	mux.HandleFunc("POST /api/fish/v1/ocean", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			RequestID string `json:"requestId"`
		}
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		out, e := h.Service.EnsureOcean(r.Context(), a, in.RequestID)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, out)
	})
	mux.HandleFunc("POST /api/fish/v1/ocean/settings", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			RequestID        string `json:"requestId"`
			OceanID          string `json:"oceanId"`
			Visibility       string `json:"visibility"`
			ExpectedRevision int    `json:"expectedRevision"`
		}
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		out, e := h.Service.Settings(r.Context(), a, in.RequestID, in.OceanID, in.Visibility, in.ExpectedRevision)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, out)
	})
	mux.HandleFunc("POST /api/fish/v1/residents", func(w http.ResponseWriter, r *http.Request) {
		var in ReleaseInput
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		out, e := h.Service.Release(r.Context(), a, in)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, out)
	})
	mux.HandleFunc("POST /api/fish/v1/residents/apply", func(w http.ResponseWriter, r *http.Request) {
		var in ApplyInput
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		out, e := h.Service.Apply(r.Context(), a, in)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, out)
	})
	mux.HandleFunc("POST /api/fish/v1/residents/recall", func(w http.ResponseWriter, r *http.Request) {
		var in RecallInput
		if e := readInput(w, r, &in); e != nil {
			failure(w, e)
			return
		}
		a, _ := actorFromContext(r.Context())
		out, e := h.Service.Recall(r.Context(), a, in)
		if e != nil {
			failure(w, e)
			return
		}
		send(w, 200, out)
	})
	mux.HandleFunc("/api/fish/mcp", h.mcp)
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
