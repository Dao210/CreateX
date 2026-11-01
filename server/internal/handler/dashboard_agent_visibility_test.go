package handler

import (
	"testing"
)

// dashboardAgentPresence is the expected membership of the three agent ids that
// matter in a per-agent dashboard response.
type dashboardAgentPresence struct {
	privateAgent bool
	publicAgent  bool
	sentinel     bool
}

func dashboardAgentIDSet[T any](rows []T, idOf func(T) string) map[string]struct{} {
	out := make(map[string]struct{}, len(rows))
	for _, r := range rows {
		out[idOf(r)] = struct{}{}
	}
	return out
}

func assertDashboardAgentPresence(
	t *testing.T,
	label string,
	ids map[string]struct{},
	want dashboardAgentPresence,
	privateAgentID, publicAgentID string,
) {
	t.Helper()
	check := func(what, id string, expected bool) {
		_, got := ids[id]
		if got != expected {
			t.Errorf("%s: %s (%s) present=%v, want %v", label, what, id, got, expected)
		}
	}
	check("private agent", privateAgentID, want.privateAgent)
	check("public agent", publicAgentID, want.publicAgent)
	check("restricted bucket", restrictedAgentsRowID, want.sentinel)
}
