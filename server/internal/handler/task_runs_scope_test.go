package handler

import (
	"net/http"
	"sort"
	"testing"

	"github.com/auro-ai/auro/server/internal/testutil"
)

// GET /api/issues/{id}/task-runs answers three different questions depending on
// its query params (#7768): the execution history the issue sidebar renders,
// "is anyone working on THIS issue right now", and "is anyone working anywhere
// in this sub-issue family right now". These tests pin the boundaries between
// them, because the only thing separating a cheap coordination read from a full
// history dump is a query param the caller may forget.

// familyFixture builds the shape the family read exists for: one parent, two
// children, and an unrelated issue in the same workspace that must never appear.
type familyFixture struct {
	agentID   string
	parentID  string
	childA    string
	childB    string
	unrelated string
}

func newFamilyFixture(t *testing.T) familyFixture {
	t.Helper()
	f := familyFixture{
		agentID:  createHandlerTestAgent(t, "FamilyRunsAgent", []byte("[]")),
		parentID: dbfx.Issue(t, "family-parent"),
	}
	f.childA = dbfx.Issue(t, "family-child-a", testutil.Cols{"parent_issue_id": f.parentID})
	f.childB = dbfx.Issue(t, "family-child-b", testutil.Cols{"parent_issue_id": f.parentID})
	f.unrelated = dbfx.Issue(t, "family-unrelated")
	return f
}

func (f familyFixture) task(t *testing.T, issueID, status string) string {
	t.Helper()
	return dbfx.Task(t, f.agentID, testutil.Cols{
		"issue_id":   issueID,
		"status":     status,
		"runtime_id": handlerTestRuntimeID(t),
	})
}

func runsRequest(t *testing.T, issueID, query string) []AgentTaskResponse {
	t.Helper()
	var out []AgentTaskResponse
	runsResponse(t, issueID, query).Want(http.StatusOK).JSON(&out)
	return out
}

// familyRequest decodes the family read's own payload. It is a different,
// deliberately smaller type than the execution log's row, so the tests decode
// it as one rather than through AgentTaskResponse — a struct that silently
// accepted both would stop noticing if the two shapes merged again.
func familyRequest(t *testing.T, issueID, query string) []ActiveRunSummary {
	t.Helper()
	var out []ActiveRunSummary
	runsResponse(t, issueID, query).Want(http.StatusOK).JSON(&out)
	return out
}

func taskIDs(runs []AgentTaskResponse) []string {
	ids := make([]string, len(runs))
	for i, r := range runs {
		ids[i] = r.ID
	}
	sort.Strings(ids)
	return ids
}

func summaryIDs(runs []ActiveRunSummary) []string {
	ids := make([]string, len(runs))
	for i, r := range runs {
		ids[i] = r.TaskID
	}
	sort.Strings(ids)
	return ids
}

func sortedCopy(ids ...string) []string {
	out := append([]string(nil), ids...)
	sort.Strings(out)
	return out
}

func sameIDs(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func TestTaskHistoryOmitsUnusedAssigneeFallbacks(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "FallbackHistoryAgent", []byte("[]"))
	issueID := dbfx.Issue(t, "fallback history")
	runtimeID := handlerTestRuntimeID(t)
	primaryID := dbfx.Task(t, agentID, testutil.Cols{"issue_id": issueID, "status": "completed", "runtime_id": runtimeID})
	want := []string{primaryID}
	for _, tc := range []struct {
		name       string
		status     string
		fallback   bool
		dispatched bool
		started    bool
		visible    bool
	}{
		{name: "inert fallback", status: "deferred", fallback: true},
		{name: "unused cancelled fallback", status: "cancelled", fallback: true},
		{name: "ordinary cancellation", status: "cancelled", visible: true},
		{name: "ordinary deferred task", status: "deferred", visible: true},
		{name: "promoted fallback", status: "queued", fallback: true, visible: true},
		{name: "dispatched unused cancellation", status: "cancelled", fallback: true, dispatched: true},
		{name: "ordinary dispatched cancellation", status: "cancelled", dispatched: true, visible: true},
		{name: "started cancellation", status: "cancelled", fallback: true, started: true, visible: true},
		{name: "failed fallback", status: "failed", fallback: true, visible: true},
		{name: "completed fallback", status: "completed", fallback: true, visible: true},
	} {
		cols := testutil.Cols{"issue_id": issueID, "status": tc.status, "trigger_summary": tc.name, "runtime_id": runtimeID}
		if tc.fallback {
			cols["escalation_for_task_id"] = primaryID
		}
		if tc.dispatched {
			cols["dispatched_at"] = testutil.Raw("now()")
		}
		if tc.started {
			cols["started_at"] = testutil.Raw("now()")
		}
		id := dbfx.Task(t, agentID, cols)
		if tc.visible {
			want = append(want, id)
		}
	}
	sort.Strings(want)
	if got := taskIDs(runsRequest(t, issueID, "")); !sameIDs(got, want) {
		t.Errorf("issue history = %v, want %v (omit only unused assignee fallbacks)", got, want)
	}
	var agentRuns []AgentTaskResponse
	testutil.Call(t, testHandler.ListAgentTasks, withURLParam(
		newRequest(http.MethodGet, "/api/agents/"+agentID+"/tasks?include_usage=true", nil), "id", agentID,
	)).Want(http.StatusOK).JSON(&agentRuns)
	if got := taskIDs(agentRuns); !sameIDs(got, want) {
		t.Errorf("agent history = %v, want %v (same visibility as issue history)", got, want)
	}
}
