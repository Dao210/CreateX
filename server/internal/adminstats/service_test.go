package adminstats

import (
	"context"
	"errors"
	"net/http"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/adminauth"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminStatsGate(t *testing.T) {
	gate, err := adminauth.New(nil, "")
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{Auth: gate}
	h := s.AdminHandler()
	// No authenticated caller.
	testutil.Call(t, h.ServeHTTP, testutil.JSONRequest(http.MethodGet, "/api/admin/stats/overview", "")).Want(401)
	// Unconfigured gate: every human is a non-admin, without a DB round trip.
	r := testutil.JSONRequest(http.MethodGet, "/api/admin/stats/overview", "")
	r.Header.Set("X-User-ID", uuid.NewString())
	testutil.Call(t, h.ServeHTTP, r).Want(403)
	// Machine credentials never receive platform authority.
	r = testutil.JSONRequest(http.MethodGet, "/api/admin/stats/trends?days=30", "")
	r.Header.Set("X-User-ID", uuid.NewString())
	r.Header.Set("X-Actor-Source", "task_token")
	testutil.Call(t, h.ServeHTTP, r).Want(403)
}

func TestTrendsParamValidation(t *testing.T) {
	s := &Service{}
	ctx := context.Background()
	if _, err := s.Trends(ctx, maxTrendDays+1, "UTC"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("days overflow accepted: %v", err)
	}
	if _, err := s.Trends(ctx, defaultTrendDays, "Not/AZone"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid tz accepted: %v", err)
	}
	if _, err := s.Trends(ctx, 0, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty tz accepted: %v", err)
	}
}

func TestOrderedFillsFixedKeys(t *testing.T) {
	rows := []CountEntry{{"expired", 2}, {"pending", 5}}
	// ordered takes (key, value) pairs; call it with a pick that adapts.
	out := ordered([]string{"pending", "accepted", "declined", "expired"}, rows, func(r CountEntry) (string, int64) { return r.Key, r.Count })
	want := []CountEntry{{"pending", 5}, {"accepted", 0}, {"declined", 0}, {"expired", 2}}
	if len(out) != len(want) {
		t.Fatalf("len=%d want=%d", len(out), len(want))
	}
	for i := range want {
		if out[i] != want[i] {
			t.Fatalf("out[%d]=%+v want %+v", i, out[i], want[i])
		}
	}
}

func TestTTLCache(t *testing.T) {
	var calls atomic.Int32
	ctx := context.Background()
	fetch := func(context.Context) (int, error) { calls.Add(1); return 7, nil }
	c := ttlCache[int]{}
	for range 3 {
		if v, err := c.get(ctx, time.Minute, fetch); err != nil || v != 7 {
			t.Fatalf("value=%d err=%v", v, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("fetches=%d, want 1 within TTL", calls.Load())
	}
	// Errors are not memoized.
	failing := ttlCache[int]{}
	for range 2 {
		if _, err := failing.get(ctx, time.Minute, func(context.Context) (int, error) { return 0, ErrInvalid }); !errors.Is(err, ErrInvalid) {
			t.Fatalf("err=%v", err)
		}
	}
	if failing.at.IsZero() {
		return // expected: error must not populate the snapshot
	}
	t.Fatal("error result was cached")
}

func TestAdminStatsDBOverviewTrendsBreakdown(t *testing.T) {
	dsn := os.Getenv("ADMIN_STATS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ADMIN_STATS_TEST_DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	fx := testutil.New(pool, "", "")
	suffix := uuid.NewString()
	email := "stats-admin-" + suffix + "@example.invalid"
	fx.UserID = fx.User(t, "Stats admin", email)
	fx.WorkspaceID = fx.Workspace(t, "Stats fixture", "stats-"+suffix)
	fx.Member(t, fx.WorkspaceID, fx.UserID, "owner")
	other := fx.User(t, "Stats member", "stats-member-"+suffix+"@example.invalid")
	ws2 := fx.Workspace(t, "Stats fixture 2", "stats2-"+suffix)
	fx.Member(t, ws2, other, "member")
	fx.Insert(t, "workspace_invitation", testutil.Cols{
		"workspace_id": fx.WorkspaceID, "inviter_id": fx.UserID,
		"invitee_email": "stats-invitee-" + suffix + "@example.invalid", "role": "member", "status": "pending",
	})
	fx.InsertNoID(t, "client_usage_daily", testutil.Cols{
		"user_id": fx.UserID, "client_type": "web", "install_id": uuid.NewString(),
		"activity_date": testutil.Raw("(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date"),
		"workspace_id":  fx.WorkspaceID, "client_version": "test", "os": "test",
		"first_active_at": testutil.Raw("CURRENT_TIMESTAMP"), "last_active_at": testutil.Raw("CURRENT_TIMESTAMP"),
	}, "user_id = $1 AND install_id = $2", fx.UserID)

	gate, err := adminauth.New(pool, email)
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{Pool: pool, Auth: gate}
	ctx := context.Background()
	allowed, err := s.Auth.IsAdmin(ctx, fx.UserID)
	if err != nil || !allowed {
		t.Fatalf("allowed=%v err=%v", allowed, err)
	}
	h := s.AdminHandler()
	admin := func(path string) *http.Request {
		r := testutil.JSONRequest(http.MethodGet, path, "")
		r.Header.Set("X-User-ID", fx.UserID)
		return r
	}

	var overview Overview
	testutil.Call(t, h.ServeHTTP, admin("/api/admin/stats/overview")).Want(200).JSON(&overview)
	if overview.Users.Total < 2 || overview.Users.New1d < 2 || overview.Users.New7d < 2 || overview.Users.New30d < 2 {
		t.Fatalf("users=%+v", overview.Users)
	}
	if overview.Workspaces.Total < 2 || overview.Workspaces.New30d < 2 {
		t.Fatalf("workspaces=%+v", overview.Workspaces)
	}
	if overview.Members < 2 {
		t.Fatalf("members=%d", overview.Members)
	}
	if overview.ActiveUsers.Day < 1 || overview.ActiveUsers.Week < 1 || overview.ActiveUsers.Month < 1 {
		t.Fatalf("activeUsers=%+v", overview.ActiveUsers)
	}
	if overview.PendingInvitations < 1 {
		t.Fatalf("pendingInvitations=%d", overview.PendingInvitations)
	}
	if overview.GeneratedAt.IsZero() {
		t.Fatal("generatedAt missing")
	}

	var breakdown Breakdown
	testutil.Call(t, h.ServeHTTP, admin("/api/admin/stats/breakdown")).Want(200).JSON(&breakdown)
	if len(breakdown.Invitations) != len(invitationOrder) || len(breakdown.MemberRoles) != len(roleOrder) || len(breakdown.WorkspaceSizes) != len(sizeOrder) {
		t.Fatalf("breakdown=%+v", breakdown)
	}
	if breakdown.Invitations[0].Key != "pending" || breakdown.Invitations[0].Count < 1 {
		t.Fatalf("invitations=%+v", breakdown.Invitations)
	}
	if breakdown.MemberRoles[0].Key != "owner" || breakdown.MemberRoles[0].Count < 1 {
		t.Fatalf("roles=%+v", breakdown.MemberRoles)
	}
	if breakdown.WorkspaceSizes[0].Key != "0" {
		t.Fatalf("sizes=%+v", breakdown.WorkspaceSizes)
	}

	var trends Trends
	testutil.Call(t, h.ServeHTTP, admin("/api/admin/stats/trends?days=7&tz=UTC")).Want(200).JSON(&trends)
	// 7 buckets, or 8 when the UTC day rolls over between the Go cutoff and
	// the SQL now() — both are valid runs of one series per calendar day.
	if len(trends.Series) < 7 || len(trends.Series) > 8 {
		t.Fatalf("series len=%d", len(trends.Series))
	}
	var newUsers, newWorkspaces, activeUsers int64
	for _, point := range trends.Series {
		newUsers += point.NewUsers
		newWorkspaces += point.NewWorkspaces
		activeUsers += point.ActiveUsers
	}
	if newUsers < 2 || newWorkspaces < 2 || activeUsers < 1 {
		t.Fatalf("sums users=%d workspaces=%d active=%d series=%+v", newUsers, newWorkspaces, activeUsers, trends.Series)
	}
	lastPoint := trends.Series[len(trends.Series)-1]
	if lastPoint.ActiveUsersWeb < 1 {
		t.Fatalf("last point=%+v", lastPoint)
	}

	// Invalid parameters reach the admin and are rejected as 400s.
	testutil.Call(t, h.ServeHTTP, admin("/api/admin/stats/trends?days=abc")).Want(400)
	testutil.Call(t, h.ServeHTTP, admin("/api/admin/stats/trends?days=366")).Want(400)
	testutil.Call(t, h.ServeHTTP, admin("/api/admin/stats/trends?tz=Bogus/Zone")).Want(400)
	// A configured non-admin is forbidden.
	r := testutil.JSONRequest(http.MethodGet, "/api/admin/stats/overview", "")
	r.Header.Set("X-User-ID", other)
	testutil.Call(t, h.ServeHTTP, r).Want(403)
}
