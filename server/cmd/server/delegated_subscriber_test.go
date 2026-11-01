package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/testutil"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// firstFixtureAgent returns an agent in the test workspace along with its
// runtime; the delegated rule only cares that the issue creator IS an agent,
// but agent_task_queue.runtime_id is NOT NULL so the task insert needs both.
func firstFixtureAgent(t *testing.T) (agentID, runtimeID string) {
	t.Helper()
	if err := testPool.QueryRow(context.Background(),
		`SELECT id::text, runtime_id::text FROM agent
		 WHERE workspace_id = $1 AND runtime_id IS NOT NULL
		 ORDER BY created_at ASC LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID, &runtimeID); err != nil {
		t.Fatalf("load fixture agent: %v", err)
	}
	return agentID, runtimeID
}

// createAgentTaskWithOriginator inserts a queued task attributed to the given
// human by that human's own action, standing in for the run an agent is
// executing when it files an issue. An invalid originator models an
// unattributed chain.
func createAgentTaskWithOriginator(t *testing.T, agentID, runtimeID string, originator pgtype.UUID) pgtype.UUID {
	t.Helper()
	return createAgentTaskInChain(t, agentID, runtimeID, originator, "direct_human", pgtype.UUID{})
}

// createAgentTaskInChain is the same insert with the attribution lineage spelled
// out: the waterfall level that resolved the human, and the parent run the human
// was copied from on a delegation hop. Both matter to the delegated rule since
// MUL-7051 — the originator alone no longer says whether a human asked for the
// work, only that the run carries one.
func createAgentTaskInChain(t *testing.T, agentID, runtimeID string, originator pgtype.UUID, source string, delegatedFrom pgtype.UUID) pgtype.UUID {
	t.Helper()
	return util.MustParseUUID(workspaceFixture(t).Task(t, agentID, testutil.Cols{
		"runtime_id":             runtimeID,
		"originator_user_id":     originator,
		"accountable_user_id":    originator,
		"originator_source":      source,
		"delegated_from_task_id": delegatedFrom,
	}))
}

// workspaceFixture builds rows in the suite's own workspace. Every row it
// inserts is removed when the test that asked for it ends, which is why the
// helpers above no longer pair an INSERT with a hand-written cleanup.
func workspaceFixture(t *testing.T) *testutil.Fixture {
	t.Helper()
	return testutil.New(testPool, testWorkspaceID, testUserID)
}

func subscriberReason(t *testing.T, queries *db.Queries, issueID, userType, userID string) string {
	t.Helper()
	subs, err := queries.ListIssueSubscribers(context.Background(), util.MustParseUUID(issueID))
	if err != nil {
		t.Fatalf("ListIssueSubscribers: %v", err)
	}
	for _, s := range subs {
		if s.UserType == userType && util.UUIDToString(s.UserID) == userID {
			return s.Reason
		}
	}
	return ""
}

// TestDelegatedSubscribe_UnattributedOriginSubscribesNobody: when the origin run
// carries no human (degraded attribution), we must not invent one to notify.
func TestDelegatedSubscribe_UnattributedOriginSubscribesNobody(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()
	registerSubscriberListeners(bus, testPool)

	agentID, runtimeID := firstFixtureAgent(t)
	task := createAgentTaskWithOriginator(t, agentID, runtimeID, pgtype.UUID{})
	issueID := createAgentOriginIssue(t, agentID, "agent_create", task, pgtype.UUID{})

	publishAgentIssueCreated(bus, issueID, agentID)

	if isSubscribed(t, queries, issueID, "member", testUserID) {
		t.Fatal("an unattributed origin task must not subscribe any member")
	}
}

// TestDelegatedSubscribe_ArmedTriggerRunSubscribesNobody is MUL-7051 as the user
// met it: an autopilot fires on its schedule, its agent files issues all day,
// and the member who armed the trigger months ago is subscribed to every one.
//
// The task row here is the shape MUL-6951 introduced and the reason a unit test
// of the rule is not enough — a real trigger_owner run carries a real member as
// originator, so nothing about the row it hands the listener looks degraded.
func TestDelegatedSubscribe_ArmedTriggerRunSubscribesNobody(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()
	registerSubscriberListeners(bus, testPool)

	agentID, runtimeID := firstFixtureAgent(t)
	task := createAgentTaskInChain(t, agentID, runtimeID, util.MustParseUUID(testUserID), "trigger_owner", pgtype.UUID{})
	issueID := createAgentOriginIssue(t, agentID, "agent_create", task, pgtype.UUID{})

	publishAgentIssueCreated(bus, issueID, agentID)

	if isSubscribed(t, queries, issueID, "member", testUserID) {
		t.Fatal("an issue filed inside an autopilot run must not subscribe the member who armed the trigger")
	}
}

// TestDelegatedSubscribe_ChainRootDecidesBelowTheFirstHop: the fix cannot read
// the origin run's own label, because a hop overwrites it with 'delegation'. One
// agent handing work to another is the ordinary way an autopilot run grows, and
// at that depth the delegated run is indistinguishable from a human-triggered
// one by anything except the chain it came from.
//
// Both directions are asserted together: the same shape, differing only in what
// started the chain, must reach opposite answers — otherwise a fix that simply
// stopped subscribing below the first hop would pass.
func TestDelegatedSubscribe_ChainRootDecidesBelowTheFirstHop(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()
	registerSubscriberListeners(bus, testPool)

	agentID, runtimeID := firstFixtureAgent(t)
	human := util.MustParseUUID(testUserID)

	for _, tc := range []struct {
		name string
		root string
		want bool
	}{
		{"member asked, two agents deep", "direct_human", true},
		{"schedule fired, two agents deep", "trigger_owner", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// The originator is copied, not chained, so it is the SAME member on
			// both runs either way (MUL-4302 §3.2).
			root := createAgentTaskInChain(t, agentID, runtimeID, human, tc.root, pgtype.UUID{})
			hop := createAgentTaskInChain(t, agentID, runtimeID, human, "delegation", root)
			issueID := createAgentOriginIssue(t, agentID, "agent_create", hop, pgtype.UUID{})

			publishAgentIssueCreated(bus, issueID, agentID)

			if got := isSubscribed(t, queries, issueID, "member", testUserID); got != tc.want {
				t.Fatalf("subscribed = %v, want %v for a chain rooted at %s", got, tc.want, tc.root)
			}
		})
	}
}

// TestDelegatedSubscribe_LineageWalkStopsAt32Hops pins the one place the fix is
// not exact. Resolving WHO the human is has no depth limit — the originator is
// copied onto every run — but proving the chain BEGAN with them means walking to
// the root, and that walk stops after 32 hops. A member-rooted chain longer than
// that loses its subscription.
//
// The limit is accepted (MUL-7051), so it is written down as behaviour rather
// than left as an implementation detail of the query: an accepted limit nothing
// asserts is one that moves by accident. Both sides are pinned, because a test
// for the truncation alone would still pass if the walk stopped at hop 3.
func TestDelegatedSubscribe_LineageWalkStopsAt32Hops(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()
	registerSubscriberListeners(bus, testPool)

	agentID, runtimeID := firstFixtureAgent(t)
	human := util.MustParseUUID(testUserID)

	// hops is the distance from the run that files the issue up to the root.
	buildChain := func(t *testing.T, hops int) pgtype.UUID {
		t.Helper()
		run := createAgentTaskInChain(t, agentID, runtimeID, human, "direct_human", pgtype.UUID{})
		for i := 0; i < hops; i++ {
			run = createAgentTaskInChain(t, agentID, runtimeID, human, "delegation", run)
		}
		return run
	}

	for _, tc := range []struct {
		name string
		hops int
		want bool
	}{
		{"the deepest chain still proven", 32, true},
		{"one hop past the limit", 33, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			issueID := createAgentOriginIssue(t, agentID, "agent_create", buildChain(t, tc.hops), pgtype.UUID{})

			publishAgentIssueCreated(bus, issueID, agentID)

			if got := isSubscribed(t, queries, issueID, "member", testUserID); got != tc.want {
				t.Fatalf("subscribed = %v, want %v at %d hops from the root", got, tc.want, tc.hops)
			}
		})
	}
}

// TestDelegatedSubscribe_ForeignLineageResolvesNobody pins the tenant guard
// (MUL-4252) across the read that now performs it. origin_id and
// delegated_from_task_id are both bare UUIDs with nothing scoping them, so an id
// belonging to another workspace's run must resolve no human at all — not the
// one that run carries.
//
// Both hops are covered because they are separate predicates in the recursive
// query, and only the anchor's is exercised by an issue pointing straight at a
// foreign run. A chain that starts here and STEPS OUT one hop up is what proves
// the recursive branch carries the guard too: with it, the lineage stops at the
// local hop and reports 'delegation' — unproven, so nobody is subscribed; without
// it, the walk reads a foreign root, sees direct_human, and subscribes.
func TestDelegatedSubscribe_ForeignLineageResolvesNobody(t *testing.T) {
	queries := db.New(testPool)
	bus := events.New()
	registerSubscriberListeners(bus, testPool)

	// A whole run in a workspace this issue has nothing to do with, attributed
	// to a member of THIS one — the shape a foreign id would exploit.
	slug := fmt.Sprintf("mul7051-foreign-%d", time.Now().UnixNano())
	unbound := testutil.New(testPool, "", testUserID)
	foreign := testutil.New(testPool, unbound.Workspace(t, "MUL-7051 foreign", slug), testUserID)
	foreignRuntime := foreign.Runtime(t, slug+"-runtime")
	foreignAgent := foreign.Agent(t, slug+"-agent", foreignRuntime)
	foreignRoot := util.MustParseUUID(foreign.Task(t, foreignAgent, testutil.Cols{
		"runtime_id":          foreignRuntime,
		"originator_user_id":  testUserID,
		"accountable_user_id": testUserID,
		"originator_source":   "direct_human",
	}))

	agentID, runtimeID := firstFixtureAgent(t)

	for _, tc := range []struct {
		name   string
		origin func() pgtype.UUID
	}{
		{
			name:   "the issue points straight at a foreign run",
			origin: func() pgtype.UUID { return foreignRoot },
		},
		{
			name: "a local run claims a foreign parent",
			origin: func() pgtype.UUID {
				return createAgentTaskInChain(t, agentID, runtimeID,
					util.MustParseUUID(testUserID), "delegation", foreignRoot)
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			issueID := createAgentOriginIssue(t, agentID, "agent_create", tc.origin(), pgtype.UUID{})

			publishAgentIssueCreated(bus, issueID, agentID)

			if isSubscribed(t, queries, issueID, "member", testUserID) {
				t.Fatal("a lineage that leaves the workspace must not resolve a subscriber")
			}
		})
	}
}

// TestDeliverToSubscriber_DelegatedTier pins the noise contract. The tier drops
// churn and nothing else: a child FINISHING is real signal, one per piece of work
// a reviewer has to act on. An earlier cut suppressed those in favour of a
// synthesized "whole batch finished" roll-up; that machinery is gone (see the
// MUL-5483 thread), and the tree-level signal comes from the parent's own status
// transition, which this same rule delivers.
//
// Which statuses ARE handoffs is issueStatusIsHandoff's job and is covered by
// TestIssueStatusIsHandoff; this table covers the routing on top of that answer.
func TestDeliverToSubscriber_DelegatedTier(t *testing.T) {
	cases := []struct {
		name      string
		reason    string
		notifType string
		handoff   bool
		want      bool
	}{
		{"direct subscriber keeps every event", "creator", "status_changed", false, true},
		{"direct subscriber keeps comments", "assignee", "new_comment", false, true},

		{"delegated skips routine progress", "delegated", "status_changed", false, false},
		{"delegated skips comment churn", "delegated", "new_comment", false, false},
		{"delegated skips assignee churn", "delegated", "assignee_changed", false, false},
		{"delegated skips date churn", "delegated", "due_date_changed", false, false},
		{"delegated skips non-status events even on a handoff", "delegated", "due_date_changed", true, false},

		{"delegated gets the handoff", "delegated", "status_changed", true, true},

		{"delegated always gets direct mentions", "delegated", "mentioned", false, true},
		{"delegated always gets failures", "delegated", "task_failed", false, true},
		{"delegated always gets agent_blocked", "delegated", "agent_blocked", false, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := deliverToSubscriber(tc.reason, tc.notifType, tc.handoff); got != tc.want {
				t.Fatalf("deliverToSubscriber(%q, %q, %v) = %v, want %v",
					tc.reason, tc.notifType, tc.handoff, got, tc.want)
			}
		})
	}
}

// TestDeliverToSubscriber_UnknownReasonIsDirect: 'reason' is an open vocabulary
// (a new rule can add one without a migration touching this file). An
// unrecognized reason must fall back to FULL delivery — silently dropping a
// user's notifications is the worse failure.
func TestDeliverToSubscriber_UnknownReasonIsDirect(t *testing.T) {
	if !deliverToSubscriber("some_future_reason", "new_comment", false) {
		t.Fatal("an unrecognized subscription reason must default to full delivery")
	}
}
