package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/testutil"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// dashboardFixtureTZ is the zone the day-boundary fixtures in this file are
// built in, and the zone their requests pin with `?tz=`. Both sides read this
// one constant because they have to agree: every `days=N` endpoint opens its
// window at start-of-day in the VIEWER's zone (resolveViewingTZ: `?tz=`, else
// the user's stored user.timezone, else UTC), so a fixture anchored in one
// zone and a window opened in another sit an offset apart. Without the
// `?tz=` these requests would inherit whatever user.timezone holds — NULL in
// the handler fixture, hence UTC.
//
// The zone is deliberately EAST of UTC, and that is what makes the pin
// load-bearing rather than decorative. A fixture built in UTC survives losing
// its `?tz=`: the fallback is UTC too, so the window opens where the fixture
// already sits and nothing notices. Built in Asia/Tokyo the run finishes at
// 15:10 UTC the previous day, so a request that falls back to UTC opens its
// window after the run ended and the assertions go red — which is the whole
// point of pinning it. Verified by mutation: dropping the parameter, and
// pinning it to UTC, both fail.
const dashboardFixtureTZ = "Asia/Tokyo"

// dashboardFixtureTZParam is dashboardFixtureTZ as a query fragment, so a
// request cannot pin a zone the fixture was not built in.
const dashboardFixtureTZParam = "tz=" + dashboardFixtureTZ

// dashboardFixtureLoc resolves dashboardFixtureTZ.
func dashboardFixtureLoc(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(dashboardFixtureTZ)
	if err != nil {
		t.Fatalf("load fixture timezone %q: %v", dashboardFixtureTZ, err)
	}
	return loc
}

// runFinishedToday returns the started_at / completed_at of a ten-minute run
// placed in the first ten minutes of the day `now` falls in, read in loc.
//
// Every endpoint these fixtures exercise filters on `completed_at >= @since`
// — the END of the run, not its start — and for the per-agent rollups @since
// is start of today in the viewer's zone (parseExactSinceParamInTZ at
// days=1). Timestamps built as `now - 30m` therefore fall out of that window
// for the first twenty minutes after midnight: the run finished yesterday,
// the window opens today, and the assertions read the empty result as nothing
// having happened. A handler job that ran at 00:13 UTC failed on exactly
// that; the next one at 00:25 passed with nothing changed but the clock. The
// date-bucketed halves ride out those twenty minutes on the extra day
// parseSinceParamInTZ hands them, which is why only their per-agent siblings
// went red. Anchoring the run on the boundary itself takes the time of day
// out of the fixture rather than special-casing the twenty minutes it bites.
//
// Start-of-day is built the way sinceFromDays builds the cutoff, so fixture
// and window agree instant for instant. In the first ten minutes after
// midnight the run ends slightly in the future, which none of these queries
// mind: they bound completed_at from below only, and the token rollup keys
// off task_usage.created_at rather than the queue row.
func runFinishedToday(now time.Time, loc *time.Location) (started, completed time.Time) {
	local := now.In(loc)
	started = time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	return started, started.Add(10 * time.Minute)
}

// pinDayWindowClock freezes the clock the request-side cutoff reads and hands
// back the same instant for the fixture, so both sides describe one moment.
//
// They read the wall clock at two different points otherwise — the fixture when
// it is built, the cutoff when the handler runs, with inserts and a rollup in
// between — and a suite that crosses midnight in that gap writes its run into
// one day and then asks for the next day's window. The gap is milliseconds, so
// it is rare and permanent: nothing about the assertions says which day they
// meant.
func pinDayWindowClock(t *testing.T, at time.Time) time.Time {
	t.Helper()
	prev := dayWindowNow
	dayWindowNow = func() time.Time { return at }
	t.Cleanup(func() { dayWindowNow = prev })
	return at
}

// TestDashboardFixtureRunLandsInsideTheWindow pins what runFinishedToday
// promises the two DB fixtures that call it: at any hour, in any zone, the
// run it places is inside the days=1 window the endpoints open. The window is
// taken from sinceFromDays — the production cutoff itself — rather than from
// a second copy of the helper's arithmetic.
//
// The midnight rows are the point of the table. A fixture built off the wall
// clock is outside that window for the first twenty minutes of the day and
// inside it for the other 23h40m, so only a synthetic clock can hold it to
// account: the suite would otherwise have to run at midnight to see the
// failure, which is how this reached CI in the first place.
func TestDashboardFixtureRunLandsInsideTheWindow(t *testing.T) {
	// Half-hour and negative offsets, so a helper that anchored on UTC
	// midnight while the request asked for another zone cannot pass.
	for _, tz := range []string{dashboardFixtureTZ, "Asia/Kolkata", "America/Los_Angeles"} {
		loc, err := time.LoadLocation(tz)
		if err != nil {
			t.Fatalf("load %s: %v", tz, err)
		}
		for _, clock := range []string{
			"2026-03-01 00:00:00",
			"2026-03-01 00:05:00",
			"2026-03-01 00:19:59",
			"2026-03-01 12:00:00",
			"2026-03-01 23:59:59",
		} {
			t.Run(tz+" "+clock, func(t *testing.T) {
				now, err := time.ParseInLocation("2006-01-02 15:04:05", clock, loc)
				if err != nil {
					t.Fatalf("parse %s: %v", clock, err)
				}
				started, completed := runFinishedToday(now, loc)

				// parseExactSinceParamInTZ trims a day off sinceFromDays, so
				// the days=1 cutoff these endpoints use is start of today.
				since := sinceFromDays(now, 0, loc)
				tomorrow := since.AddDate(0, 0, 1)

				if got := completed.Sub(started); got != 10*time.Minute {
					t.Errorf("run lasted %s, want 10m — the >=600s the run-time assertion reads", got)
				}
				if completed.Before(since) {
					t.Errorf("completed_at %s precedes the days=1 cutoff %s: `completed_at >= @since` drops the fixture", completed, since)
				}
				if !completed.Before(tomorrow) {
					t.Errorf("completed_at %s is past the day that opened at %s", completed, since)
				}
				if started.Before(since) {
					t.Errorf("started_at %s precedes the days=1 cutoff %s", started, since)
				}
			})
		}
	}
}

// TestDashboardAgentRunTimeReportsMeteredTaskCoverage proves the runtime
// rollup distinguishes terminal runs from the subset that reported usage.
func TestDashboardAgentRunTimeReportsMeteredTaskCoverage(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	var agentID, runtimeID string
	dbfx.QueryRow(t, `
		SELECT id, runtime_id FROM agent
		WHERE workspace_id = $1 AND runtime_id IS NOT NULL
		LIMIT 1
	`, testWorkspaceID).Scan(&agentID, &runtimeID)

	readCoverage := func() (int32, int32) {
		rows, err := testHandler.Queries.ListDashboardAgentRunTime(context.Background(), db.ListDashboardAgentRunTimeParams{
			WorkspaceID: parseUUID(testWorkspaceID),
			Since:       pgtype.Timestamptz{Time: time.Now().Add(-24 * time.Hour), Valid: true},
		})
		if err != nil {
			t.Fatalf("list dashboard agent runtime: %v", err)
		}
		for _, row := range rows {
			if uuidToString(row.AgentID) == agentID {
				return row.TaskCount, row.MeteredTaskCount
			}
		}
		return 0, 0
	}
	baseTasks, baseMetered := readCoverage()

	issueID := dbfx.Issue(t, "dashboard usage coverage")
	finished := testutil.Cols{
		"issue_id":     issueID,
		"runtime_id":   runtimeID,
		"started_at":   testutil.Raw("now() - interval '2 minutes'"),
		"completed_at": testutil.Raw("now() - interval '1 minute'"),
	}
	meteredTaskID := dbfx.Task(t, agentID, finished, testutil.Cols{"status": "completed"})
	dbfx.Task(t, agentID, finished, testutil.Cols{"status": "failed"})
	dbfx.Insert(t, "task_usage", testutil.Cols{
		"task_id":       meteredTaskID,
		"provider":      "qoderclicn",
		"model":         "bailian/tp/qwen3.8-max",
		"input_tokens":  120,
		"output_tokens": 30,
	})

	tasks, metered := readCoverage()
	if tasks-baseTasks != 2 || metered-baseMetered != 1 {
		t.Fatalf("coverage delta = terminal:%d metered:%d, want 2/1", tasks-baseTasks, metered-baseMetered)
	}
}

// TestDashboardUsageDailyBucketsByViewerTimezone proves the `?tz=` query
// param drives the calendar-day boundary: the same UTC instant lands under
// a different `date` for a UTC viewer vs an America/Los_Angeles viewer.
// This is the core promise of the timezone-architecture RFC.
func TestDashboardUsageDailyBucketsByViewerTimezone(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	var runtimeID, agentID string
	dbfx.QueryRow(t, `SELECT id FROM agent_runtime WHERE workspace_id = $1 LIMIT 1`, testWorkspaceID).Scan(&runtimeID)
	dbfx.QueryRow(t, `SELECT id FROM agent WHERE workspace_id = $1 LIMIT 1`, testWorkspaceID).Scan(&agentID)

	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM task_usage_hourly WHERE runtime_id = $1 AND provider = 'tz-bucket-test'`, runtimeID)
	})
	// One bucket at 04:00 UTC two days ago. 04:00 UTC is still the
	// previous evening in America/Los_Angeles (UTC-7/-8), so the UTC
	// viewer and the LA viewer must see this row under different dates.
	var bucketHour time.Time
	dbfx.QueryRow(t, `
		INSERT INTO task_usage_hourly (
			bucket_hour, workspace_id, runtime_id, agent_id, project_id,
			provider, model,
			input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, event_count
		)
		VALUES (
			((CURRENT_DATE - 2)::timestamp + interval '4 hours') AT TIME ZONE 'UTC',
			$1, $2, $3, NULL, 'tz-bucket-test', 'tz-bucket-model',
			999, 0, 0, 0, 1
		)
		ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_key DO UPDATE
			SET input_tokens = EXCLUDED.input_tokens
		RETURNING bucket_hour
	`, testWorkspaceID, runtimeID, agentID).Scan(&bucketHour)

	utcDate := bucketHour.UTC().Format("2006-01-02")
	laLoc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load LA location: %v", err)
	}
	laDate := bucketHour.In(laLoc).Format("2006-01-02")
	if utcDate == laDate {
		t.Fatalf("test setup: UTC and LA dates must differ, both %s", utcDate)
	}

	readDate := func(tz string) string {
		w := httptest.NewRecorder()
		testHandler.GetDashboardUsageDaily(w, newRequest("GET", "/api/dashboard/usage/daily?days=10&tz="+tz, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("tz=%s: expected 200, got %d: %s", tz, w.Code, w.Body.String())
		}
		var rows []struct {
			Date  string `json:"date"`
			Model string `json:"model"`
		}
		_ = json.NewDecoder(w.Body).Decode(&rows)
		for _, r := range rows {
			if r.Model == "tz-bucket-model" {
				return r.Date
			}
		}
		t.Fatalf("tz=%s: tz-bucket-model row not found in %v", tz, rows)
		return ""
	}

	if got := readDate("UTC"); got != utcDate {
		t.Errorf("UTC viewer: expected date %s, got %s", utcDate, got)
	}
	if got := readDate("America/Los_Angeles"); got != laDate {
		t.Errorf("LA viewer: expected date %s, got %s", laDate, got)
	}
}

// readAgentRunTime returns (total_seconds, task_count, cancelled_count) for
// one agent from GetDashboardAgentRunTime. Zeroes when the agent has no row.
func readAgentRunTime(t *testing.T, agentID string) (int64, int32, int32) {
	t.Helper()
	w := httptest.NewRecorder()
	testHandler.GetDashboardAgentRunTime(w, newRequest("GET", "/api/dashboard/agent-runtime?days=10&tz=UTC", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var rows []struct {
		AgentID        string `json:"agent_id"`
		TotalSeconds   int64  `json:"total_seconds"`
		TaskCount      int32  `json:"task_count"`
		CancelledCount int32  `json:"cancelled_count"`
	}
	if err := json.NewDecoder(w.Body).Decode(&rows); err != nil {
		t.Fatalf("decode agent run time: %v", err)
	}
	for _, r := range rows {
		if r.AgentID == agentID {
			return r.TotalSeconds, r.TaskCount, r.CancelledCount
		}
	}
	return 0, 0, 0
}

// TestPruneTaskUsageHourlyDirty covers the dirty-queue TTL. Both the RFC
// (§7.1) and the rollup-pipeline migration call this THE most-easily-missed correctness
// requirement of the hourly pipeline: without the prune, a row that escapes
// the per-tick drain (crash mid-tick, worker paused during an incident)
// pins its bucket's recompute forever and the queue grows unbounded.
func TestPruneTaskUsageHourlyDirty(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	// This test calls rollup_task_usage_hourly(), which advances the shared
	// watermark as a side effect; serialise so it does not perturb another
	// package's rollup test (MUL-3980).
	lockRollupSingleton(t)
	ctx := context.Background()

	// task_usage_hourly_dirty carries no FKs (it is a queue), so synthetic
	// UUIDs are fine. `provider` tags the rows for isolated cleanup.
	const tag = "ttl-prune-test"
	t.Cleanup(func() {
		testPool.Exec(ctx, `DELETE FROM task_usage_hourly_dirty WHERE provider = $1`, tag)
	})
	seed := func(model, age string) {
		dbfx.Exec(t, `
			INSERT INTO task_usage_hourly_dirty (
				bucket_hour, workspace_id, runtime_id, agent_id, project_id,
				provider, model, enqueued_at
			)
			VALUES (
				date_trunc('hour', now()), gen_random_uuid(), gen_random_uuid(),
				gen_random_uuid(), NULL, $1, $2, now() - $3::interval
			)
		`, tag, model, age)
	}
	countModel := func(model string) int {
		var n int
		testPool.QueryRow(ctx,
			`SELECT COUNT(*) FROM task_usage_hourly_dirty WHERE provider = $1 AND model = $2`,
			tag, model,
		).Scan(&n)
		return n
	}

	seed("stale-row", "8 days")
	seed("fresh-row", "1 day")

	// Default 7-day retention: the 8-day row goes, the 1-day row stays.
	var pruned int64
	dbfx.QueryRow(t, `SELECT prune_task_usage_hourly_dirty()`).Scan(&pruned)
	if pruned < 1 {
		t.Errorf("expected prune to report at least the one stale row deleted, got %d", pruned)
	}
	if got := countModel("stale-row"); got != 0 {
		t.Errorf("default prune: expected stale row deleted, still %d present", got)
	}
	if got := countModel("fresh-row"); got != 1 {
		t.Errorf("default prune: expected fresh row kept, got %d", got)
	}

	// An explicit retention shorter than the surviving row's age drops it.
	dbfx.Exec(t, `SELECT prune_task_usage_hourly_dirty(interval '12 hours')`)
	if got := countModel("fresh-row"); got != 0 {
		t.Errorf("12h-retention prune: expected fresh row deleted, still %d present", got)
	}

	// The cron entry folds the prune in so operators do
	// not need a second scheduled job. A single tick must drop a stale row.
	seed("cron-fold-row", "9 days")
	dbfx.Exec(t, `SELECT rollup_task_usage_hourly()`)
	if got := countModel("cron-fold-row"); got != 0 {
		t.Errorf("cron entry did not fold in the prune: stale row still present (%d)", got)
	}
}

// TestRollupTaskUsageHourlyCapsWindowAtOneDay covers the catch-up cap
// in rollup_task_usage_hourly(): when the watermark has
// fallen far behind (worker paused for an incident or a migration freeze),
// a single tick must advance it by at most one day, so a multi-week backlog
// drains in bounded steps instead of one giant statement holding advisory
// lock 4246. The existing watermark test only parks the watermark one hour
// back, so the cap itself is never exercised there.
func TestRollupTaskUsageHourlyCapsWindowAtOneDay(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	// Serialise against any other package's rollup test (MUL-3980). Acquire
	// the guard BEFORE registering the watermark-restore cleanup below so
	// that cleanup (LIFO) runs while the guard is still held, and the guard
	// is released last.
	lockRollupSingleton(t)
	ctx := context.Background()

	// Other tests drive rollup_task_usage_hourly_window directly and never
	// read the watermark; the idempotency test parks it itself. Restore to
	// now() so nothing downstream observes a stale value.
	t.Cleanup(func() {
		testPool.Exec(ctx,
			`UPDATE task_usage_hourly_rollup_state SET watermark_at = now(), last_error = NULL WHERE id = 1`)
	})

	park := func(behind string) {
		dbfx.Exec(t, `
			UPDATE task_usage_hourly_rollup_state
			   SET watermark_at = now() - $1::interval, last_error = NULL
			 WHERE id = 1
		`, behind)
	}
	ageDays := func() float64 {
		var sec float64
		dbfx.QueryRow(t, `
			SELECT EXTRACT(EPOCH FROM (now() - watermark_at))
			  FROM task_usage_hourly_rollup_state WHERE id = 1
		`).Scan(&sec)
		return sec / 86400
	}
	tick := func(label string) {
		dbfx.Exec(t, `SELECT rollup_task_usage_hourly()`)
	}

	// Park 3 days back. One tick advances by exactly one day (v_from + 1d,
	// well short of now()-5min), leaving the watermark ~2 days behind.
	park("3 days")
	tick("tick 1")
	if age := ageDays(); age < 1.9 || age > 2.1 {
		t.Fatalf("after one tick: expected watermark ~2 days behind, got %.3f days", age)
	}

	// A second tick advances another bounded day → ~1 day behind.
	tick("tick 2")
	if age := ageDays(); age < 0.9 || age > 1.1 {
		t.Fatalf("after two ticks: expected watermark ~1 day behind, got %.3f days", age)
	}

	// Once within a day of now, the tick snaps the watermark to now()-5min
	// (LEAST picks the now bound) rather than taking a further fixed day.
	tick("tick 3")
	if age := ageDays(); age > 0.02 {
		t.Fatalf("after catch-up: expected watermark within minutes of now, got %.3f days", age)
	}
}

// TestDashboardFailureWireContractKeepsEmptyReason pins the success bucket's
// wire form. The client's zod schema defaults a missing `failure_reason` to
// "" — the succeeded bucket — which is only safe while the server always
// emits the field. Adding `omitempty` to the struct tag would strip it from
// exactly the success rows and silently turn every window into a 100% error
// rate, so that regression is caught here rather than in a dashboard.
func TestDashboardFailureWireContractKeepsEmptyReason(t *testing.T) {
	// Each case decodes into its OWN map. json.Unmarshal merges into a
	// non-nil map rather than resetting it, so sharing one across cases would
	// leave the first payload's failure_reason in place and let a later
	// omitempty regression pass unnoticed — the exact failure this test
	// exists to catch.
	for _, tc := range []struct {
		name string
		row  any
	}{
		{"daily", DashboardFailureDailyResponse{Date: "2026-05-19", TaskCount: 3}},
		{"by-agent", DashboardFailureByAgentResponse{AgentID: "a", TaskCount: 3}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(tc.row)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			decoded := map[string]any{}
			if err := json.Unmarshal(body, &decoded); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if _, present := decoded["failure_reason"]; !present {
				t.Errorf("succeeded rows must serialize an explicit empty failure_reason, got %s", body)
			}
		})
	}
}

// A fixture built a hair before midnight is still counted by a request handled
// a hair after it.
//
// The two sides used to read the wall clock at different moments — the fixture
// when it was built, the cutoff when the handler ran, with inserts and a rollup
// in between. Crossing midnight in that gap wrote the run into one day and then
// asked for the next day's window, and the row vanished. Pinning one instant is
// what removes the question; this asserts the removal at the instant where it
// used to bite, rather than trusting that the suite never runs at 23:59.
func TestDashboardFixtureSurvivesTheMidnightStraddle(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	loc := dashboardFixtureLoc(t)
	// 23:59:59.9 in the fixture's own zone: one tenth of a second of the day
	// left when the fixture is built.
	local := time.Date(2026, 3, 1, 23, 59, 59, 900_000_000, loc)
	at := pinDayWindowClock(t, local)

	if got := dashboardRunTimeSeconds(t, at, loc, "days=1&"+dashboardFixtureTZParam); got < 600 {
		t.Errorf("agent-runtime reported %ds for a run built at %s, want >=600 — "+
			"the fixture and the cutoff have to describe the same day even when the clock is about to turn over",
			got, local.Format(time.RFC3339Nano))
	}
}

// The timezone pin is load-bearing, at an instant that proves it.
//
// A request that loses its `?tz=` falls back to the fixture user's stored zone
// — UTC — while the fixture stays in dashboardFixtureTZ, and the two windows
// then sit an offset apart. Whether that offset actually hides the run depends
// on the time of day, so asserting it against the wall clock proves nothing for
// most of the day. Pinned at 02:00 UTC on a fixed date, Tokyo's day began at
// 15:00 UTC the day before and UTC's began two hours ago: the run is behind the
// UTC cutoff and must not be counted.
func TestDashboardMismatchedRequestTimezoneHidesTheRun(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	loc := dashboardFixtureLoc(t)
	at := pinDayWindowClock(t, time.Date(2026, 3, 1, 2, 0, 0, 0, time.UTC))

	matched := dashboardRunTimeSeconds(t, at, loc, "days=1&"+dashboardFixtureTZParam)
	if matched < 600 {
		t.Fatalf("the matched-timezone request reported %ds, want >=600 — this test's premise is gone", matched)
	}
	if mismatched := dashboardRunTimeSeconds(t, at, loc, "days=1&tz=UTC"); mismatched != 0 {
		t.Errorf("a request pinned to UTC counted %ds of a run the fixture placed in %s — "+
			"the pin is meant to be the thing that keeps the two windows together, so a mismatch has to be visible here",
			mismatched, dashboardFixtureTZ)
	}
}
