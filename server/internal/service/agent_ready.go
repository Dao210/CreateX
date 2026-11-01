package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/auro-ai/auro/server/internal/dispatch"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
)

// AgentAvailability is what a readiness check concluded, in the vocabulary the
// callers actually branch on.
//
// The distinction that matters is not "ready or not" but whether WAITING is a
// plan. A sleeping laptop comes back on its own, so queued work is right to
// wait for it; an agent bound to nothing, or bound to a machine whose CLI
// cannot run, will never pick that work up until a human acts. dispatch's
// reason codes already draw that line — this type is the server-side half so
// every admission path draws it the same way.
type AgentAvailability int

const (
	// AgentAvailable: the agent can take work now.
	AgentAvailable AgentAvailability = iota
	// AgentWaitable: not runnable right now, but nothing is broken — the
	// machine is offline and work queued for it runs when it returns.
	AgentWaitable
	// AgentBlocked: nothing will claim this agent's work until someone
	// intervenes. Callers must refuse the trigger and say why.
	AgentBlocked
)

// AgentVerdict is a readiness decision plus everything a caller needs to act on
// it: the wire reason code, and — when the daemon reported one — the command
// that repairs the runtime.
type AgentVerdict struct {
	Availability AgentAvailability
	// Reason is the dispatch code for a non-available verdict, empty otherwise.
	Reason dispatch.ReasonCode
	// Repair is the fix the daemon reported for an unusable runtime: the npm
	// package that owns the broken entry point and the command that reinstalls
	// it. Absent for every other verdict, and for a runtime whose daemon is too
	// old to report one.
	Repair *RuntimeRepair
	// Detail is the daemon's own description, for logs and for the record left
	// on a blocked non-interactive trigger. Never parsed.
	Detail string
}

// Ready reports whether the agent can take work right now.
func (v AgentVerdict) Ready() bool { return v.Availability == AgentAvailable }

// Blocked reports whether waiting is futile and the caller must refuse the
// trigger rather than queue it.
func (v AgentVerdict) Blocked() bool { return v.Availability == AgentBlocked }

// RuntimeRepair mirrors the daemon's agent.ExecFormatRepair over the wire.
type RuntimeRepair struct {
	Package string `json:"package,omitempty"`
	Command string `json:"command,omitempty"`
	// Shell is the interpreter Command is written for, as reported by the
	// machine that must run it ("bash", "powershell"). Rendered as the code
	// block's language so a Windows user is not handed POSIX syntax in a bash
	// fence. Empty from a daemon too old to report it.
	Shell string `json:"shell,omitempty"`
}

// runtimeOfflineReason is the daemon's structured explanation, stored on the
// runtime row's metadata by the deregister handler.
type runtimeOfflineReason struct {
	Code   string         `json:"code"`
	Detail string         `json:"detail"`
	Repair *RuntimeRepair `json:"repair"`
	// Installing: the daemon has an automatic install in flight, so this offline
	// runtime is expected to come back on its own and work may queue.
	Installing bool `json:"installing"`
}

// runtimeOfflineCodeNotExecutable is the daemon's code for "the OS refuses to
// execute this agent CLI" (daemon.RuntimeOfflineCodeNotExecutable). Compared as
// a string because the server must not import the daemon package.
const runtimeOfflineCodeNotExecutable = "not_executable"

// runtimeOfflineCodeDshProfile is the daemon's code for "this runtime's DSH
// runtime profile is not installed" (daemon.RuntimeOfflineCodeDshProfile). Same
// string-comparison rule as above, and the same MUL-6164 semantics: with no
// install configured the wait never resolves, so the trigger is refused.
// runtimeOfflineReason.Installing is the exception — a daemon that is installing
// the profile right now resolves it by itself.
const runtimeOfflineCodeDshProfile = "dsh_profile"

// AgentReadiness reports whether an agent can accept new work right now, and
// what the caller should do when it cannot.
//
// The lookup carries the connection to read on plus the source label the
// runtime read is attributed to (MUL-6884), so each admission path stays
// distinguishable in auro_agent_runtime_lookup_total.
//
// err is non-nil only on DB lookup failure for the runtime row. Callers that
// treat a transient DB error as "do not skip" (the autopilot admission gate)
// should swallow it; callers that need a hard yes/no (the squad-leader
// pre-enqueue check in the handler) should fail closed.
//
// This is the single source of truth shared by:
//   - service.shouldSkipDispatch (autopilot admission gate)
//   - service.dispatchRunOnly    (squad-leader runtime check, MUL-2429)
//   - handler.isSquadLeaderReady (issue-assign / comment-trigger path)
//   - the direct-agent trigger paths, which consult it for the BLOCKED verdict
//     only: an offline machine still queues, because that wait ends by itself.
//
// Keeping these aligned matters because the paths can otherwise drift — e.g.
// one starts allowing "starting" runtimes while another doesn't, and the bug
// only surfaces when a user assigns the same agent through two different entry
// points. Touch this function, all of them move together.
func AgentReadiness(ctx context.Context, lookup RuntimeLookup, agent db.Agent) (AgentVerdict, error) {
	if agent.ArchivedAt.Valid {
		return AgentVerdict{
			Availability: AgentBlocked,
			Reason:       dispatch.ReasonTargetUnavailable,
			Detail:       "agent is archived",
		}, nil
	}
	if !agent.RuntimeID.Valid {
		return AgentVerdict{
			Availability: AgentBlocked,
			Reason:       dispatch.ReasonAgentRuntimeRequired,
			Detail:       "agent has no runtime bound",
		}, nil
	}
	rt, err := lookup.Get(ctx, agent.RuntimeID)
	if err != nil {
		return AgentVerdict{}, err
	}
	return runtimeVerdict(rt, agent), nil
}

// runtimeVerdict combines runtime health with the ownership binding that
// determines whether this agent can execute there.
func runtimeVerdict(rt db.AgentRuntime, agent db.Agent) AgentVerdict {
	if rt.Visibility == "private" && rt.OwnerID.Valid && (!agent.OwnerID.Valid || agent.OwnerID != rt.OwnerID) {
		return AgentVerdict{
			Availability: AgentBlocked,
			Reason:       dispatch.ReasonRuntimeAccessDenied,
			Detail:       "agent owner does not match private runtime owner",
		}
	}
	if rt.Status == "online" {
		return AgentVerdict{Availability: AgentAvailable}
	}
	// Offline with a reason the daemon says a human must repair: refuse rather
	// than queue, and carry the repair so the caller can show it.
	if reason, ok := parseRuntimeOfflineReason(rt.Metadata); ok {
		switch {
		case reason.Code == runtimeOfflineCodeNotExecutable:
			return AgentVerdict{
				Availability: AgentBlocked,
				Reason:       dispatch.ReasonRuntimeUnusable,
				Repair:       reason.Repair,
				Detail:       reason.Detail,
			}
		// A missing runtime profile is the same shape of finding — the machine
		// is reachable and its CLI cannot serve work — but its own reason code,
		// because the CLI is not the broken part and "reinstall the CLI" copy
		// would send the user to the wrong repair. The one exception is an
		// install the daemon is running right now: that wait DOES end by
		// itself, so the work queues instead of being refused.
		case reason.Code == runtimeOfflineCodeDshProfile && !installClaimHolds(reason, rt):
			return AgentVerdict{
				Availability: AgentBlocked,
				Reason:       dispatch.ReasonRuntimeProfileMissing,
				Repair:       reason.Repair,
				Detail:       reason.Detail,
			}
		}
	}
	return AgentVerdict{
		Availability: AgentWaitable,
		Reason:       dispatch.ReasonRuntimeOffline,
		Detail:       "agent runtime is " + rt.Status,
	}
}

// runtimeInstallClaimWindow is how long an `installing` claim on a runtime row
// is honoured before the row is read as a plain missing profile.
//
// The claim is what makes this one offline runtime worth queueing behind, so a
// claim that outlives its install recreates exactly the failure the structured
// reason exists to prevent — work queued behind something that stopped. The
// daemon withdraws the claim when an install gives up, but a withdraw cannot be
// guaranteed: the verdict is built before the runtime ids the withdraw needs are
// known, the corrective Deregister is best-effort and runs on an already-
// cancelled context during shutdown, and a daemon restarted mid-install does not
// track the row at all.
//
// So the claim is bounded rather than guaranteed. SetAgentRuntimeOfflineWithReason
// stamps updated_at, and the install it describes is itself bounded by the
// daemon's provisioning timeout; a window comfortably longer than that covers a
// real install while capping every way the claim can be left behind. The
// withdraw stays as the fast path — this is the floor under it.
const runtimeInstallClaimWindow = 5 * time.Minute

// installClaimHolds reports whether a runtime row's in-flight-install claim is
// still worth queueing behind.
//
// A row with no usable timestamp cannot be bounded, so the claim is not honoured:
// the cost of refusing during a real install is one retry the notice already
// asks for, and the cost of honouring a stale claim is work that queues until it
// expires.
func installClaimHolds(reason runtimeOfflineReason, rt db.AgentRuntime) bool {
	if !reason.Installing || !rt.UpdatedAt.Valid {
		return false
	}
	return time.Since(rt.UpdatedAt.Time) < runtimeInstallClaimWindow
}

// parseRuntimeOfflineReason reads the daemon's explanation off a runtime row.
// A row with no reason, or metadata this server cannot parse, simply has no
// explanation — never a different verdict.
func parseRuntimeOfflineReason(metadata []byte) (runtimeOfflineReason, bool) {
	if len(metadata) == 0 {
		return runtimeOfflineReason{}, false
	}
	var envelope struct {
		OfflineReason *runtimeOfflineReason `json:"offline_reason"`
	}
	if err := json.Unmarshal(metadata, &envelope); err != nil || envelope.OfflineReason == nil {
		return runtimeOfflineReason{}, false
	}
	return *envelope.OfflineReason, true
}
