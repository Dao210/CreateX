package gameprogress

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"
)

const maxBody = 64 * 1024

type HTTP struct {
	Store Store
}

func send(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, err error) {
	var p *Problem
	if errors.As(err, &p) {
		send(w, p.Status, map[string]string{"code": p.Code})
		return
	}
	send(w, http.StatusServiceUnavailable, map[string]string{"code": "service_unavailable"})
}

func readInput(w http.ResponseWriter, r *http.Request, out any) error {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return problem("unsupported_media_type", 415)
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			return problem("payload_too_large", 413)
		}
		return problem("invalid_input", 400)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(out); err != nil {
		return problem("invalid_input", 400)
	}
	var extra any
	if err = decoder.Decode(&extra); err != io.EOF {
		return problem("invalid_input", 400)
	}
	return nil
}

func (h *HTTP) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/game-progress", h.get)
	mux.HandleFunc("PUT /api/game-progress/{game}", h.put)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := ActorFromContext(r.Context()); !ok {
			fail(w, problem("unauthenticated", 401))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}

func (h *HTTP) get(w http.ResponseWriter, r *http.Request) {
	actor, _ := ActorFromContext(r.Context())
	rows, err := h.Store.Load(r.Context(), actor.WorkspaceID, actor.UserID)
	if err != nil {
		fail(w, err)
		return
	}
	response := struct {
		WorkspaceID string     `json:"workspaceId"`
		Siege       *siegeView `json:"siege"`
		Tanks       *tankView  `json:"tanks"`
	}{WorkspaceID: actor.WorkspaceID}
	if stored, ok := rows[GameSiege]; ok {
		view := viewSiege(stored)
		response.Siege = &view
	}
	if stored, ok := rows[GameTanks]; ok {
		view := viewTanks(stored)
		response.Tanks = &view
	}
	send(w, http.StatusOK, response)
}

func (h *HTTP) put(w http.ResponseWriter, r *http.Request) {
	actor, _ := ActorFromContext(r.Context())
	game := r.PathValue("game")
	switch game {
	case GameSiege:
		var input SiegeProgress
		if err := readInput(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		if err := validateSiege(input); err != nil {
			fail(w, err)
			return
		}
		stored, err := h.Store.Merge(r.Context(), actor.WorkspaceID, actor.UserID, GameSiege, func(current []byte) ([]byte, error) {
			return mergeSiege(current, input)
		})
		if err != nil {
			fail(w, err)
			return
		}
		var progress SiegeProgress
		_ = json.Unmarshal(stored.Payload, &progress)
		send(w, http.StatusOK, struct {
			WorkspaceID string `json:"workspaceId"`
			Stars       []int  `json:"stars"`
			UpdatedAt   string `json:"updatedAt"`
		}{actor.WorkspaceID, progress.Stars, stored.UpdatedAt.UTC().Format(time.RFC3339)})
	case GameTanks:
		var input TankProgress
		if err := readInput(w, r, &input); err != nil {
			fail(w, err)
			return
		}
		if err := validateTanks(input); err != nil {
			fail(w, err)
			return
		}
		stored, err := h.Store.Merge(r.Context(), actor.WorkspaceID, actor.UserID, GameTanks, func(current []byte) ([]byte, error) {
			return mergeTanks(current, input)
		})
		if err != nil {
			fail(w, err)
			return
		}
		var progress TankProgress
		_ = json.Unmarshal(stored.Payload, &progress)
		send(w, http.StatusOK, struct {
			WorkspaceID string `json:"workspaceId"`
			Best        int    `json:"best"`
			Unlocked    int    `json:"unlocked"`
			UpdatedAt   string `json:"updatedAt"`
		}{actor.WorkspaceID, progress.Best, progress.Unlocked, stored.UpdatedAt.UTC().Format(time.RFC3339)})
	default:
		fail(w, problem("not_found", 404))
	}
}
