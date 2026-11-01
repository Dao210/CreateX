package gameadmin

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/auro-ai/auro/server/internal/testutil"
)

func TestResolve(t *testing.T) {
	for _, tc := range []struct {
		name, id, scope, access, visibility       string
		defaultVisible, bound, available, visible bool
	}{
		{"default", "siege", "all", "inherit", "inherit", true, false, true, true},
		{"hidden remains accessible", "tanks", "all", "inherit", "hide", true, false, true, false},
		{"show exception", "siege", "all", "inherit", "show", false, false, true, true},
		{"deny overrides show", "siege", "all", "deny", "show", true, false, false, false},
		{"selected requires allow", "siege", "selected", "inherit", "show", true, false, false, false},
		{"selected allow", "siege", "selected", "allow", "inherit", true, false, true, true},
		{"disabled wins", "tanks", "disabled", "allow", "show", true, false, false, false},
		{"life bound", "life", "bound", "inherit", "inherit", true, true, true, true},
		{"life cannot escape binding", "life", "bound", "allow", "show", true, false, false, false},
		{"unknown scope closed", "siege", "future", "allow", "show", true, false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out := Resolve(tc.id, tc.scope, tc.defaultVisible, tc.access, tc.visibility, tc.bound)
			if out.Available != tc.available || out.Visible != tc.visible {
				t.Fatalf("got %+v, want available=%v visible=%v", out, tc.available, tc.visible)
			}
		})
	}
}

func TestNormalizeRejectsAmbiguousPolicies(t *testing.T) {
	visible := true
	for _, in := range []PolicyInput{
		{Scope: "all", Overrides: []Override{}},
		{Scope: "unknown", DefaultVisible: &visible, Overrides: []Override{}},
		{Scope: "all", DefaultVisible: &visible},
		{Scope: "all", DefaultVisible: &visible, Overrides: []Override{{WorkspaceID: "not-a-uuid", Access: "allow", Visibility: "inherit"}}},
		{Scope: "bound", DefaultVisible: &visible, Overrides: []Override{}},
	} {
		if _, err := normalize("siege", in); err == nil {
			t.Fatalf("accepted %+v", in)
		}
	}
	if _, err := normalize("life", PolicyInput{Scope: "all", DefaultVisible: &visible, Overrides: []Override{}}); err == nil {
		t.Fatal("life accepted all-world scope")
	}
}

func TestGameGuardsRequireResolvedMembership(t *testing.T) {
	s := &Service{}
	next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("unauthenticated request reached game") })
	for _, h := range []http.Handler{s.Guard("tanks", next), s.ProgressGuard(next), http.HandlerFunc(s.MemberHandler)} {
		testutil.Call(t, h.ServeHTTP, httptest.NewRequest("GET", "/api/games", nil)).Want(401)
	}
}
