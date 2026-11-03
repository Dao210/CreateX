// Package attribution resolves the authorizing and accountable human for chat
// and automation executions. Database lookups stay in the calling service.
package attribution

import "github.com/jackc/pgx/v5/pgtype"

// Source is the waterfall level that resolved the accountable human for a run.
// Stored verbatim in agent_task_queue.originator_source. Kept as free strings
// (no DB CHECK) so a newly-modeled trigger path can introduce a source without
// a schema migration (MUL-4302 §7).
type Source string

const (
	SourceDirectHuman   Source = "direct_human"
	SourceTriggerOwner  Source = "trigger_owner"
	SourceRuleOwner     Source = "rule_owner"
	SourceOwnerFallback Source = "owner_fallback"
	SourceUnattributed  Source = "unattributed"
)

// Precise reports whether src is a compliance-grade (non-degraded) attribution.
// owner_fallback, backfill, and unattributed are degraded and count against the
// attribution-coverage health metric (MUL-4302 §9).
func (src Source) Precise() bool {
	switch src {
	case SourceDirectHuman, SourceTriggerOwner, SourceRuleOwner:
		return true
	default:
		return false
	}
}

// String returns the raw source label (defaults to unattributed when empty) so
// callers never stamp a zero value.
func (src Source) String() string {
	if src == "" {
		return string(SourceUnattributed)
	}
	return string(src)
}

// EvidenceKind tags the direct cause of a run so every attribution can jump to
// its evidence row. Free strings, paired with an evidence ref id.
type EvidenceKind string

const (
	EvidenceAutopilotRun EvidenceKind = "autopilot_run"
	EvidenceChat         EvidenceKind = "chat"
)

// Result distinguishes authorization (UserID) from audit responsibility.
type Result struct {
	UserID            pgtype.UUID
	AccountableUserID pgtype.UUID
	Source            Source

	RuleVersionID pgtype.UUID
	EvidenceKind  EvidenceKind
	EvidenceRefID pgtype.UUID
}

// finalizeAttribution enforces the one-way Phase 1 accountability invariant
// (MUL-4302 §11): a resolved originator IS the accountable human, so
// `originator_user_id IS NOT NULL ⟹ accountable_user_id = originator_user_id`.
// Every Result flows through here. It mirrors UserID onto AccountableUserID
// whenever UserID is valid; when UserID is NULL (no human authorized the run) it
// leaves AccountableUserID exactly as the caller set it — the single divergence
// point where rule_owner (rule publisher) and owner_fallback (agent owner) name an
// accountable human for audit while authorization correctly carries none. The
// enqueue call sites never special-case this.
func finalizeAttribution(r Result) Result {
	if r.UserID.Valid {
		r.AccountableUserID = r.UserID
	}
	return r
}

// DirectHumanRun carries the chat sender or manual-run initiator as both
// authorizing and accountable human. Missing identity remains unattributed.
func DirectHumanRun(userID pgtype.UUID, evidenceKind EvidenceKind, evidenceRefID pgtype.UUID) Result {
	if !userID.Valid {
		return finalizeAttribution(Result{Source: SourceUnattributed, EvidenceKind: evidenceKind, EvidenceRefID: evidenceRefID})
	}
	return finalizeAttribution(Result{
		UserID:        userID,
		Source:        SourceDirectHuman,
		EvidenceKind:  evidenceKind,
		EvidenceRefID: evidenceRefID,
	})
}

// Unattributed builds an explicit "no human resolved" result for an enqueue path
// that currently carries no accountable human — today only the autopilot run_only
// dispatch, whose precise rule_owner attribution (accountable = the active rule
// version's publisher) lands with the rule-version snapshot table in a later
// Phase 1 increment. Stamping SourceUnattributed with real evidence keeps the row
// off the NULL-source bypass and distinguishes "classified, no human" from a
// pre-migration NULL, while leaving originator/accountable NULL so authorization
// still correctly says "no human authorized this run".
func Unattributed(evidenceKind EvidenceKind, evidenceRefID pgtype.UUID) Result {
	return finalizeAttribution(Result{Source: SourceUnattributed, EvidenceKind: evidenceKind, EvidenceRefID: evidenceRefID})
}

// RuleOwner builds attribution for an autopilot-triggered run whose firing
// trigger has no created_by principal (MUL-4302 §3.4) — the coarser fallback
// behind TriggerOwner. publisherUserID, the member who published the active rule
// version, becomes the AUDIT-accountable human only; UserID (the originator, the
// authorization value) stays NULL.
//
// This asymmetry with TriggerOwner is deliberate (MUL-6951, Elon review). The rule
// publisher never armed anything — it is a guess at "who probably owns this rule",
// recovered from a version snapshot. Promoting it to the authorization principal
// would hand a legacy trigger somebody's invoke rights without that person having
// authorized a single run. A run that lands here therefore carries no originator
// and the invoke gate fails closed, which is the intended outcome for a trigger
// too old to name its creator.
//
// ruleVersionID records which snapshot resolved it; evidence points the caller
// supplies (autopilot_run for automation). A missing
// publisher (system-published rule, or no version resolved yet) degrades to
// unattributed so we never fabricate a human.
func RuleOwner(publisherUserID, ruleVersionID pgtype.UUID, evidenceKind EvidenceKind, evidenceRefID pgtype.UUID) Result {
	r := Result{
		RuleVersionID: ruleVersionID,
		EvidenceKind:  evidenceKind,
		EvidenceRefID: evidenceRefID,
	}
	if publisherUserID.Valid {
		r.Source = SourceRuleOwner
		r.AccountableUserID = publisherUserID
	} else {
		r.Source = SourceUnattributed
	}
	return finalizeAttribution(r)
}

// TriggerOwner builds attribution for an autopilot schedule/webhook run keyed to
// the firing trigger's created_by principal (MUL-4302; MUL-6951). It sets UserID —
// the ORIGINATOR — so the run carries that human's authorization context, exactly
// as a manual "run now" by the same person would (MUL-6951; Bohan's call).
// finalizeAttribution mirrors it onto the accountable side, satisfying the
// originator == accountable invariant migration 190/197 enforces. Evidence is
// caller-supplied (autopilot_run for automation). An
// invalid principal degrades to unattributed so callers without one fall back to
// rule_owner rather than fabricating a human.
//
// WHY the originator and not accountable-only (MUL-6951): arming a trigger IS the
// authorization — the same act as clicking "run now", just deferred. Withholding
// the originator did not remove that authority, it only made every capability the
// automation legitimately needed arrive as a separately-bounded borrow path
// (MUL-4857, then MUL-6691, then #7902), each with a hand-written scope no
// operator could see. Carrying the human here grants exactly that human's own
// rights — canInvokeAgent still runs unchanged, so this is not an escalation —
// and lets those borrow paths be deleted.
//
// The caller (service.ResolveAutopilotTriggerPrincipal) resolves that human from
// the trigger's created_by — never rewritten by an edit, and for a legacy trigger a
// backfilled inference rather than proof of its creator — never from published_by:
// published_by transfers on a substantive edit, so using it would let a
// collaborator editing a cron expression silently move whose rights the
// automation runs with. The same
// resolver feeds dispatch admission, so one run can never be admitted as one human
// and executed as another.
func TriggerOwner(creatorUserID pgtype.UUID, evidenceKind EvidenceKind, evidenceRefID pgtype.UUID) Result {
	r := Result{
		EvidenceKind:  evidenceKind,
		EvidenceRefID: evidenceRefID,
	}
	if creatorUserID.Valid {
		r.Source = SourceTriggerOwner
		r.UserID = creatorUserID
	} else {
		r.Source = SourceUnattributed
	}
	return finalizeAttribution(r)
}

// OwnerFallback degrades an UNATTRIBUTED result to owner_fallback (MUL-4302 §3.5):
// the agent owner becomes the accountable human so no run is left without one, but
// this is a DEGRADED label (Source.Precise() == false) and must be surfaced
// distinctly in reporting. It is audit-only — originator (UserID) stays NULL, so
// authorization is unaffected. Applied at the enqueue boundary ONLY when the
// resolved source is unattributed and the workspace has not opted into fail-closed;
// a precise result, or an invalid ownerUserID (nothing to fall back to), passes
// through unchanged so a human is never fabricated.
func OwnerFallback(r Result, ownerUserID pgtype.UUID) Result {
	if r.Source != SourceUnattributed || !ownerUserID.Valid {
		return r
	}
	r.Source = SourceOwnerFallback
	r.AccountableUserID = ownerUserID
	return r
}
