package adminstats

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type followupInput struct {
	ExpectedVersion int32  `json:"expectedVersion"`
	AssigneeID      string `json:"assigneeId"`
	DueOn           string `json:"dueOn"`
	Note            string `json:"note"`
	Close           bool   `json:"close"`
}

func (s *Service) worldAssignees(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	rows, err := db.New(s.Pool).WorldOpsAdminCandidates(ctx, s.Auth.Emails())
	if err != nil {
		fail(w, err)
		return
	}
	type candidate struct {
		ID   pgtype.UUID `json:"id"`
		Name string      `json:"name"`
	}
	items := make([]candidate, 0, len(rows))
	for _, row := range rows {
		items = append(items, candidate{ID: row.ID, Name: row.Name})
	}
	send(w, http.StatusOK, items)
}

func (s *Service) worldFollowups(w http.ResponseWriter, r *http.Request) {
	world, err := worldOpsID(r, "world")
	if err != nil {
		fail(w, err)
		return
	}
	offset, err := worldOpsOffset(r.URL.Query().Get("page"), 24)
	if err != nil {
		fail(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	items, err := db.New(s.Pool).ListWorldOpsFollowups(ctx, db.ListWorldOpsFollowupsParams{WorkspaceID: world, PageOffset: offset})
	if err != nil {
		fail(w, err)
		return
	}
	send(w, http.StatusOK, map[string]any{"items": items[:min(len(items), 24)], "more": len(items) > 24})
}

func (s *Service) worldFollowupEntries(w http.ResponseWriter, r *http.Request) {
	world, err := worldOpsID(r, "world")
	if err != nil {
		fail(w, err)
		return
	}
	id, err := worldOpsID(r, "followup")
	if err != nil {
		fail(w, err)
		return
	}
	offset, err := worldOpsOffset(r.URL.Query().Get("page"), 50)
	if err != nil {
		fail(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	items, err := db.New(s.Pool).ListWorldOpsFollowupEntries(ctx, db.ListWorldOpsFollowupEntriesParams{WorkspaceID: world, FollowupID: id, PageOffset: offset})
	if err != nil {
		fail(w, err)
		return
	}
	send(w, http.StatusOK, map[string]any{"items": items[:min(len(items), 50)], "more": len(items) > 50})
}

func (s *Service) saveWorldFollowup(w http.ResponseWriter, r *http.Request) {
	world, err := worldOpsID(r, "world")
	if err != nil {
		fail(w, err)
		return
	}
	id, err := worldOpsID(r, "followup")
	if err != nil {
		fail(w, err)
		return
	}
	var input followupInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
		fail(w, ErrInvalid)
		return
	}
	if err := s.writeFollowup(r.Context(), r.Header.Get("X-User-ID"), world, id, input); err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) writeFollowup(ctx context.Context, actorID string, world, id pgtype.UUID, input followupInput) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	actor, err := util.ParseUUID(actorID)
	if err != nil {
		return ErrInvalid
	}
	assignee := actor
	if input.AssigneeID != "" {
		assignee, err = util.ParseUUID(input.AssigneeID)
		if err != nil {
			return ErrInvalid
		}
	} else if input.ExpectedVersion != 0 {
		return ErrInvalid
	}
	var due pgtype.Date
	if input.DueOn != "" {
		value, err := time.Parse(time.DateOnly, input.DueOn)
		if err != nil || value.Year() < 2000 {
			return ErrInvalid
		}
		due = date(value)
	}
	note := strings.TrimSpace(input.Note)
	creating := input.ExpectedVersion == 0
	if input.ExpectedVersion < 0 || input.ExpectedVersion == math.MaxInt32 || utf8.RuneCountInString(note) > 1000 ||
		((creating || input.Close) && note == "") || (creating && input.Close) {
		return ErrInvalid
	}
	action := "updated"
	if creating {
		action = "opened"
	} else if input.Close {
		action = "closed"
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := db.New(tx)
	if _, err = q.LockWorkspaceForChatSessionCreate(ctx, world); errors.Is(err, pgx.ErrNoRows) {
		return errWorldNotFound
	} else if err != nil {
		return err
	}
	if err = s.Auth.LockActor(ctx, q, actorID); err != nil {
		return err
	}
	if assignee != actor && !input.Close {
		// An open item can be reassigned after its former owner loses access.
		email, err := q.LockGlobalAdminUser(ctx, assignee)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if !s.Auth.AllowsEmail(email) {
			return ErrInvalid
		}
	}

	var row db.WorldOpsFollowup
	if creating {
		row, err = q.CreateWorldOpsFollowup(ctx, db.CreateWorldOpsFollowupParams{
			ID: id, WorkspaceID: world, AssigneeID: assignee, Reason: note, DueOn: due,
		})
	} else {
		row, err = q.UpdateWorldOpsFollowup(ctx, db.UpdateWorldOpsFollowupParams{
			ID: id, WorkspaceID: world, AssigneeID: assignee, DueOn: due,
			ExpectedVersion: input.ExpectedVersion, CloseFollowup: input.Close,
		})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		entry, err := q.GetWorldOpsFollowupEntry(ctx, db.GetWorldOpsFollowupEntryParams{
			WorkspaceID: world, FollowupID: id, Version: input.ExpectedVersion + 1,
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil && entry.ActorID == actor && entry.Action == action && entry.AssigneeID == assignee &&
			entry.DueOn.Valid == due.Valid && (!due.Valid || entry.DueOn.Time.Equal(due.Time)) && entry.Note == note {
			return nil
		}
		return errWorldConflict
	}
	if err != nil {
		return err
	}
	if err = q.InsertWorldOpsFollowupEntry(ctx, db.InsertWorldOpsFollowupEntryParams{
		WorkspaceID: world, FollowupID: id, Version: row.Version, ActorID: actor,
		Action: action, AssigneeID: assignee, DueOn: due, Note: note,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
