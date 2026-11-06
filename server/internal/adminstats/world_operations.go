package adminstats

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/auro-ai/auro/server/internal/gameadmin"
	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

const worldOpsZone = "Asia/Shanghai"

var (
	errWorldNotFound = errors.New("world_not_found")
	errWorldConflict = errors.New("world_followup_conflict")
	worldOpsLocation = time.FixedZone(worldOpsZone, 8*60*60)
	worldSegments    = []string{"", "new", "visited", "browsing", "returning", "active", "creative", "first", "cohort", "no-visit", "no-creation", "quiet", "following", "mine"}
)

type worldOpsWindow struct {
	From          string    `json:"from"`
	To            string    `json:"to"`
	TimeZone      string    `json:"timeZone"`
	AsOf          time.Time `json:"asOf"`
	CoverageStart time.Time `json:"coverageStart"`
	VisitDays     int       `json:"coveredVisitDays"`
}

type worldOpsPage struct {
	worldOpsWindow
	Matched  int64           `json:"matched"`
	Totals   json.RawMessage `json:"totals"`
	Items    json.RawMessage `json:"items"`
	Trend    json.RawMessage `json:"trend"`
	Games    json.RawMessage `json:"games"`
	Activity json.RawMessage `json:"activity"`
}

func instant(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

func date(value time.Time) pgtype.Date {
	return pgtype.Date{Time: value, Valid: true}
}

func worldOpsOffset(value string, pageSize int32) (int32, error) {
	if value == "" {
		return 0, nil
	}
	n, err := strconv.ParseInt(value, 10, 32)
	if err != nil || n < 0 || n > 1000000/int64(pageSize) {
		return 0, ErrInvalid
	}
	return int32(n) * pageSize, nil
}

func worldOpsParams(query url.Values, actor, world pgtype.UUID, now, coverage time.Time) (db.WorldOpsReadParams, worldOpsWindow, error) {
	today, _ := time.ParseInLocation(time.DateOnly, now.In(worldOpsLocation).Format(time.DateOnly), worldOpsLocation)
	from, to := today.AddDate(0, 0, -29), today
	if query.Get("from") != "" || query.Get("to") != "" {
		var err error
		from, err = time.ParseInLocation(time.DateOnly, query.Get("from"), worldOpsLocation)
		if err != nil {
			return db.WorldOpsReadParams{}, worldOpsWindow{}, ErrInvalid
		}
		to, err = time.ParseInLocation(time.DateOnly, query.Get("to"), worldOpsLocation)
		if err != nil || from.Year() < 2000 || to.Before(from) || to.After(today) || to.Sub(from) >= 365*24*time.Hour {
			return db.WorldOpsReadParams{}, worldOpsWindow{}, ErrInvalid
		}
	}
	snapshot := now
	if raw := query.Get("asOf"); raw != "" {
		value, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil || value.After(now) || !value.After(from) {
			return db.WorldOpsReadParams{}, worldOpsWindow{}, ErrInvalid
		}
		snapshot = value
	}
	cutoff := snapshot
	if end := to.AddDate(0, 0, 1); end.Before(cutoff) {
		cutoff = end
	}
	game, segment := query.Get("game"), query.Get("segment")
	search := strings.TrimSpace(query.Get("q"))
	if world.Valid {
		segment, search = "", ""
	}
	if (game != "" && (!slices.Contains(gameadmin.GameIDs, game) || game == "life")) || !slices.Contains(worldSegments, segment) || len(search) > 300 {
		return db.WorldOpsReadParams{}, worldOpsWindow{}, ErrInvalid
	}
	offset, err := worldOpsOffset(query.Get("page"), 25)
	if err != nil {
		return db.WorldOpsReadParams{}, worldOpsWindow{}, err
	}
	if world.Valid {
		offset = 0
	}
	days := int(to.Sub(from)/(24*time.Hour)) + 1
	params := db.WorldOpsReadParams{
		FromAt: instant(from), ToAt: instant(cutoff), SnapshotAt: instant(snapshot), PreviousAt: instant(from.AddDate(0, 0, -days)),
		FromDay: date(from), ToDay: date(to), CoverageAt: instant(coverage), ActorID: actor, WorldID: world,
		Game: game, Search: search, Segment: segment, PageOffset: offset,
	}
	if point := query.Get("point"); point != "" && !world.Valid {
		day, err := time.ParseInLocation(time.DateOnly, point, worldOpsLocation)
		if err != nil || day.Before(from) || day.After(to) || !slices.Contains([]string{"new", "visited", "returning", "active", "creative"}, segment) {
			return db.WorldOpsReadParams{}, worldOpsWindow{}, ErrInvalid
		}
		params.PointAt, params.PointEnd = instant(day), instant(day.AddDate(0, 0, 1))
	}
	coveredVisitDays := 0
	for day := from; !day.After(to) && day.Before(cutoff); day = day.AddDate(0, 0, 1) {
		if day.AddDate(0, 0, 1).After(coverage) {
			coveredVisitDays++
		}
	}
	return params, worldOpsWindow{From: from.Format(time.DateOnly), To: to.Format(time.DateOnly), TimeZone: worldOpsZone, AsOf: snapshot.UTC(), CoverageStart: coverage.UTC(), VisitDays: coveredVisitDays}, nil
}

func (s *Service) readWorldOps(r *http.Request, world pgtype.UUID) (worldOpsPage, db.WorldOpsReadParams, error) {
	actor, err := util.ParseUUID(r.Header.Get("X-User-ID"))
	if err != nil {
		return worldOpsPage{}, db.WorldOpsReadParams{}, ErrInvalid
	}
	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	q := db.New(s.Pool)
	coverage, err := q.WorldOpsCoverage(ctx)
	if err != nil {
		return worldOpsPage{}, db.WorldOpsReadParams{}, err
	}
	params, window, err := worldOpsParams(r.URL.Query(), actor, world, time.Now(), coverage.Time)
	if err != nil {
		return worldOpsPage{}, params, err
	}
	rows, err := q.WorldOpsRead(ctx, params)
	if err != nil {
		return worldOpsPage{}, params, err
	}
	page := worldOpsPage{
		worldOpsWindow: window, Matched: rows.Matched, Totals: rows.Totals,
		Items: rows.Items, Trend: rows.Trend, Games: rows.Games, Activity: rows.Activity,
	}
	return page, params, nil
}

func (s *Service) worlds(w http.ResponseWriter, r *http.Request) {
	page, _, err := s.readWorldOps(r, pgtype.UUID{})
	if err != nil {
		fail(w, err)
		return
	}
	send(w, http.StatusOK, page)
}

func worldOpsID(r *http.Request, field string) (pgtype.UUID, error) {
	id, err := util.ParseUUID(r.PathValue(field))
	if err != nil {
		return id, ErrInvalid
	}
	return id, nil
}

func (s *Service) world(w http.ResponseWriter, r *http.Request) {
	world, err := worldOpsID(r, "world")
	if err != nil {
		fail(w, err)
		return
	}
	page, params, err := s.readWorldOps(r, world)
	if err != nil {
		fail(w, err)
		return
	}
	if page.Matched == 0 {
		fail(w, errWorldNotFound)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	q := db.New(s.Pool)
	diagnostics, err := q.WorldOpsDiagnostics(ctx, db.WorldOpsDiagnosticsParams{WorkspaceID: world, FromAt: params.FromAt, ToAt: params.ToAt})
	if err != nil {
		fail(w, err)
		return
	}
	policies := make([]gameadmin.Effective, 0, len(gameadmin.GameIDs))
	for _, game := range gameadmin.GameIDs {
		policy, err := s.Games.Effective(ctx, util.UUIDToString(world), game)
		if err != nil {
			fail(w, err)
			return
		}
		policies = append(policies, policy)
	}
	send(w, http.StatusOK, struct {
		worldOpsPage
		Diagnostics db.WorldOpsDiagnosticsRow `json:"diagnostics"`
		Policies    []gameadmin.Effective     `json:"policies"`
	}{page, diagnostics, policies})
}

func (s *Service) RecordVisit(w http.ResponseWriter, r *http.Request) {
	platform, _, _ := middleware.ClientMetadataFromContext(r.Context())
	if platform != "web" && platform != "desktop" {
		fail(w, ErrInvalid)
		return
	}
	world, worldErr := util.ParseUUID(middleware.WorkspaceIDFromContext(r.Context()))
	actor, actorErr := util.ParseUUID(r.Header.Get("X-User-ID"))
	if worldErr != nil || actorErr != nil {
		fail(w, ErrInvalid)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	n, err := db.New(s.Pool).RecordWorldOpsVisit(ctx, db.RecordWorldOpsVisitParams{ID: world, UserID: actor})
	if err != nil {
		fail(w, err)
		return
	}
	if n == 0 {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
