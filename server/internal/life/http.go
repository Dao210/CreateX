// Package life owns the lifecycle and atomic persistence of the TypeScript world engine.
package life

import (
	"context"
	"encoding/json"
	"errors"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"io"
	"net/http"
	"strconv"

	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/util"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Reader interface {
	GetLifeSnapshot(context.Context, pgtype.UUID) ([]byte, error)
}

func Handler(reader Reader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := middleware.MemberFromContext(r.Context()); !ok {
			http.Error(w, "unauthenticated", http.StatusUnauthorized)
			return
		}
		serveSnapshot(w, r, reader, middleware.WorkspaceIDFromContext(r.Context()))
	}
}

func serveSnapshot(w http.ResponseWriter, r *http.Request, reader Reader, workspaceID string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "application/json")
	id, err := util.ParseUUID(workspaceID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"invalid_workspace"}`))
		return
	}
	// One SQL statement gives agents, resources, actions and events the same MVCC snapshot.
	raw, err := reader.GetLifeSnapshot(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = w.Write([]byte(`{"world":null,"agents":[],"resources":[],"actions":[],"events":[]}`))
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"code":"life_unavailable"}`))
		return
	}
	_, _ = w.Write(raw)
}

func (s *Service) Commands(w http.ResponseWriter, r *http.Request) {
	member, ok := middleware.MemberFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 12*1024)
	raw, err := io.ReadAll(r.Body)
	var command TownCommand
	if err != nil || strictJSON(raw, &command) != nil || !commandKeys(raw, command.Kind) {
		http.Error(w, `{"code":"invalid_request"}`, 400)
		return
	}
	result, err := s.Repository.Command(r.Context(), middleware.WorkspaceIDFromContext(r.Context()), util.UUIDToString(member.UserID), command, s.Coordinator != nil && s.Coordinator.Ready())
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err != nil {
		var failure *TownError
		if errors.As(err, &failure) {
			w.WriteHeader(failure.Status)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": failure.Code})
			return
		}
		w.WriteHeader(503)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "life_unavailable"})
		return
	}
	s.notify(middleware.WorkspaceIDFromContext(r.Context()))
	_ = json.NewEncoder(w).Encode(result)
}

func HistoryHandler(reader interface {
	GetLifeHistory(context.Context, db.GetLifeHistoryParams) ([]byte, error)
}) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := middleware.MemberFromContext(r.Context()); !ok {
			http.Error(w, "unauthenticated", 401)
			return
		}
		id, err := util.ParseUUID(middleware.WorkspaceIDFromContext(r.Context()))
		since, parseErr := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if err != nil || parseErr != nil || since < 0 || since > 9007199254740991 {
			http.Error(w, `{"code":"invalid_request"}`, 400)
			return
		}
		raw, err := reader.GetLifeHistory(r.Context(), db.GetLifeHistoryParams{WorkspaceID: id, SinceSequence: since})
		if err != nil {
			w.WriteHeader(503)
			_, _ = w.Write([]byte(`{"code":"life_unavailable"}`))
			return
		}
		_, _ = w.Write(raw)
	}
}

func commandKeys(raw []byte, kind string) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return false
	}
	allowed := map[string]bool{"kind": true, "requestId": true}
	var keys []string
	switch kind {
	case "message":
		keys = []string{"residentId", "text"}
	case "activity":
		keys = []string{"residentId", "title", "interest", "place", "startsIn", "duration"}
	case "resident":
		keys = []string{"name", "occupation", "background", "interests"}
	case "prototype":
		keys = []string{"name", "variant"}
	case "suggest_project":
		keys = []string{"residentId", "prototypeId"}
	default:
		return false
	}
	for _, key := range keys {
		allowed[key] = true
	}
	for key := range fields {
		if !allowed[key] {
			return false
		}
	}
	return true
}
