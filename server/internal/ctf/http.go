package ctf

import (
	"archive/zip"
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"io"
	"mime"
	"net/http"
	"sort"
	"strconv"
)

//go:embed rule-kit.gen.json
var ruleKit []byte

type HTTP struct{ Service *Service }

func send(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func failure(w http.ResponseWriter, e error) {
	var p *Problem
	if errors.As(e, &p) {
		send(w, p.Status, map[string]string{"error": p.Code})
		return
	}
	send(w, 503, map[string]string{"error": "service_unavailable"})
}
func readInput(w http.ResponseWriter, r *http.Request, out any) error {
	media, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if e != nil || media != "application/json" {
		return problem("unsupported_media_type", 415)
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 300*1024))
	decoder.DisallowUnknownFields()
	if e = decoder.Decode(out); e != nil {
		return problem("invalid_request", 400)
	}
	if e = decoder.Decode(new(any)); e != io.EOF {
		return problem("invalid_request", 400)
	}
	return nil
}
func (h *HTTP) Handler() http.Handler {
	mux := http.NewServeMux()
	type action func(context.Context, Actor, *http.Request) (any, error)
	mount := func(pattern string, fn action) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			a, _ := r.Context().Value(actorKey{}).(Actor)
			out, e := fn(r.Context(), a, r)
			if e != nil {
				failure(w, e)
				return
			}
			send(w, 200, out)
		})
	}
	mount("GET /api/ctf/v1/strategies/{id}", func(ctx context.Context, a Actor, r *http.Request) (any, error) {
		revision, e := strconv.Atoi(r.URL.Query().Get("revision"))
		if e != nil {
			return nil, problem("invalid_request", 400)
		}
		return h.Service.ReadStrategy(ctx, a, r.PathValue("id"), revision)
	})
	mount("GET /api/ctf/v1/state", func(ctx context.Context, a Actor, _ *http.Request) (any, error) { return h.Service.State(ctx, a) })
	mount("GET /api/ctf/v1/matches/{id}", func(ctx context.Context, a Actor, r *http.Request) (any, error) {
		return h.Service.GetMatch(ctx, a, r.PathValue("id"))
	})
	mount("POST /api/ctf/v1/strategies", func(ctx context.Context, a Actor, r *http.Request) (any, error) {
		var in SaveInput
		if e := readInput(nil, r, &in); e != nil {
			return nil, e
		}
		return h.Service.Save(ctx, a, in)
	})
	mount("POST /api/ctf/v1/entries", func(ctx context.Context, a Actor, r *http.Request) (any, error) {
		var in EnrollInput
		if e := readInput(nil, r, &in); e != nil {
			return nil, e
		}
		return h.Service.Enroll(ctx, a, in)
	})
	mount("POST /api/ctf/v1/entries/withdraw", func(ctx context.Context, a Actor, r *http.Request) (any, error) {
		var in struct{}
		if e := readInput(nil, r, &in); e != nil {
			return nil, e
		}
		return h.Service.Simple(ctx, a, "withdraw", "", false)
	})
	mount("POST /api/ctf/v1/strategies/archive", func(ctx context.Context, a Actor, r *http.Request) (any, error) {
		var in struct {
			ID       string `json:"id"`
			Archived bool   `json:"archived"`
		}
		if e := readInput(nil, r, &in); e != nil {
			return nil, e
		}
		return h.Service.Simple(ctx, a, "archive", in.ID, in.Archived)
	})
	mount("POST /api/ctf/v1/batches", func(ctx context.Context, a Actor, r *http.Request) (any, error) {
		var in struct {
			RequestID string `json:"requestId"`
		}
		if e := readInput(nil, r, &in); e != nil {
			return nil, e
		}
		return h.Service.Start(ctx, a, in.RequestID)
	})
	mount("POST /api/ctf/v1/batches/control", func(ctx context.Context, a Actor, r *http.Request) (any, error) {
		var in struct {
			ID     string `json:"id"`
			Action string `json:"action"`
		}
		if e := readInput(nil, r, &in); e != nil {
			return nil, e
		}
		return h.Service.Control(ctx, a, in.ID, in.Action)
	})
	mux.HandleFunc("GET /api/ctf/v1/rule-kit.zip", func(w http.ResponseWriter, r *http.Request) {
		var files map[string]string
		if e := json.Unmarshal(ruleKit, &files); e != nil {
			failure(w, e)
			return
		}
		var buffer bytes.Buffer
		archive := zip.NewWriter(&buffer)
		names := []string{}
		for name := range files {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			f, e := archive.Create(name)
			if e != nil {
				failure(w, e)
				return
			}
			if _, e = io.WriteString(f, files[name]); e != nil {
				failure(w, e)
				return
			}
		}
		if e := archive.Close(); e != nil {
			failure(w, e)
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="ctf-rules-12-rts-1.0.zip"`)
		_, _ = w.Write(buffer.Bytes())
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		a, ok := r.Context().Value(actorKey{}).(Actor)
		if !ok {
			failure(w, problem("unauthenticated", 401))
			return
		}
		if _, e := h.Service.member(r.Context(), db.New(h.Service.Pool), a); e != nil {
			failure(w, e)
			return
		}
		if e := h.Service.available(r.Context(), a.WorkspaceID); e != nil {
			failure(w, e)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
