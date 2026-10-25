package mcpadmin

import (
	"context"
	"errors"
	"net/http"
	"os"
	"testing"

	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminEmailConfigurationAndPolicyInput(t *testing.T) {
	s, e := New(nil, " Admin@Example.com,other@example.com ", nil)
	if e != nil || !s.Configured() || !s.emails["admin@example.com"] {
		t.Fatalf("configuration=%+v error=%v", s, e)
	}
	for _, bad := range []string{"*", "someone", "Name <admin@example.com>"} {
		if _, e = New(nil, bad, nil); e == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	d := Definition{Tools: []Tool{{Name: "read"}, {Name: "write"}}}
	enabled := true
	for _, in := range []PolicyInput{{Enabled: &enabled}, {Enabled: &enabled, DisabledTools: []string{"unknown"}}, {Enabled: &enabled, DisabledTools: []string{"read", "read"}}, {DisabledTools: []string{}}} {
		if _, e = normalizePolicy(in, d); !errors.Is(e, ErrInvalid) {
			t.Fatalf("accepted %+v", in)
		}
	}
	tools, e := normalizePolicy(PolicyInput{Enabled: &enabled, DisabledTools: []string{"write", "read"}}, d)
	if e != nil || tools[0] != "read" || tools[1] != "write" {
		t.Fatalf("tools=%v, err=%v", tools, e)
	}
}
func TestAdminUnconfiguredAndMachineAccess(t *testing.T) {
	s, _ := New(nil, "", nil)
	h := (&HTTP{Service: s}).Handler()
	r := testutil.JSONRequest(http.MethodGet, "/api/admin/access", "")
	r.Header.Set("X-User-ID", uuid.NewString())
	var access map[string]any
	testutil.Call(t, h.ServeHTTP, r).Want(200).JSON(&access)
	if access["isAdmin"] != false || access["configured"] != false {
		t.Fatalf("access=%v", access)
	}
	r = testutil.JSONRequest(http.MethodGet, "/api/admin/mcp", "")
	r.Header.Set("X-User-ID", uuid.NewString())
	r.Header.Set("X-Actor-Source", "task_token")
	testutil.Call(t, h.ServeHTTP, r).Want(403)
	testutil.Call(t, h.ServeHTTP, testutil.JSONRequest(http.MethodGet, "/api/admin/access", "")).Want(401)
}
func TestAdminDBGlobalPolicyAuditAndPagination(t *testing.T) {
	dsn := os.Getenv("MCP_ADMIN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("MCP_ADMIN_TEST_DATABASE_URL not set")
	}
	pool, e := pgxpool.New(context.Background(), dsn)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(pool.Close)
	fx := testutil.New(pool, "", "")
	suffix := uuid.NewString()
	email := "mcp-admin-" + suffix + "@example.invalid"
	fx.UserID = fx.User(t, "MCP admin", email)
	fx.WorkspaceID = fx.Workspace(t, "Admin fixture", "admin-"+suffix)
	fx.Member(t, fx.WorkspaceID, fx.UserID, "owner")
	id := "test-" + suffix
	fx.Cleanup(t, "DELETE FROM mcp_service_policy WHERE service_id=$1", id)
	fx.Cleanup(t, "DELETE FROM mcp_activity WHERE service_id=$1", id)
	s, e := New(pool, email, []Definition{{ID: id, Tools: []Tool{{Name: "read"}, {Name: "write"}}}})
	if e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	allowed, e := s.IsAdmin(ctx, fx.UserID)
	if e != nil || !allowed {
		t.Fatalf("access=%v, %v", allowed, e)
	}
	policy, e := s.Policy(ctx, id)
	if e != nil || !policy.Enabled || policy.Revision != 0 {
		t.Fatalf("default=%+v, %v", policy, e)
	}
	enabled := true
	input := PolicyInput{Enabled: &enabled, DisabledTools: []string{"write"}}
	policy, e = s.UpdatePolicy(ctx, fx.UserID, id, input)
	if e != nil || policy.Revision != 1 || policy.Allows("write") {
		t.Fatalf("policy=%+v, %v", policy, e)
	}
	_, e = s.UpdatePolicy(ctx, fx.UserID, id, input)
	if !errors.Is(e, ErrConflict) {
		t.Fatalf("stale policy=%v", e)
	}
	other := fx.User(t, "Other member", "other-"+suffix+"@example.invalid")
	_, e = s.UpdatePolicy(ctx, other, id, PolicyInput{Enabled: &enabled, DisabledTools: []string{}, ExpectedRevision: 1})
	if !errors.Is(e, ErrForbidden) {
		t.Fatalf("other update=%v", e)
	}
	for range 53 {
		if e = s.RecordCall(ctx, Call{ServiceID: id, WorkspaceID: fx.WorkspaceID, ActorID: fx.UserID, ToolName: "write", Outcome: "blocked", ErrorCode: "mcp_tool_disabled", DurationMS: 4}); e != nil {
			t.Fatal(e)
		}
	}
	overview, e := s.Overview(ctx)
	if e != nil || overview[0].Stats.Calls != 53 || overview[0].Stats.Blocked != 53 || overview[0].Stats.AverageMS != 4 {
		t.Fatalf("overview=%+v, %v", overview, e)
	}
	page, e := s.Activity(ctx, id, "", "", "", "")
	if e != nil || len(page.Items) != 50 || page.NextCursor == "" {
		t.Fatalf("page=%+v, %v", page, e)
	}
	next, e := s.Activity(ctx, id, "", "", "", page.NextCursor)
	if e != nil || len(next.Items) != 4 || next.NextCursor != "" {
		t.Fatalf("next=%+v, %v", next, e)
	}
	if next.Items[len(next.Items)-1].Kind != "policy_change" {
		t.Fatalf("audit=%+v", next.Items)
	}
	for _, item := range page.Items {
		if len(item.Details) != 2 || string(item.Details) != "{}" {
			t.Fatalf("call stores unnecessary data: %s", item.Details)
		}
	}
	filtered, e := s.Activity(ctx, id, "read", "", "", "")
	if e != nil || len(filtered.Items) != 0 {
		t.Fatalf("filter=%+v, %v", filtered, e)
	}
	_, e = s.Activity(ctx, id, "", "", "", "invalid")
	if !errors.Is(e, ErrInvalid) {
		t.Fatalf("cursor=%v", e)
	}
}
