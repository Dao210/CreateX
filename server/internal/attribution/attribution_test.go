package attribution

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

// uid builds a valid, deterministic pgtype.UUID from a single seed byte so the
// tests can assert on identity without importing the util package.
func uid(seed byte) pgtype.UUID {
	var u pgtype.UUID
	for i := range u.Bytes {
		u.Bytes[i] = seed
	}
	u.Valid = true
	return u
}

var (
	human   = uid(0x11)
	other   = uid(0x22)
	chat    = uid(0xC0)
	srcTask = uid(0x5A)
	ruleVer = uid(0x4E)
)

// TestAccountableMirrorsOriginatorInvariant is the MUL-4302 §11 acceptance check
// at the classification layer: EVERY result the resolver produces must satisfy the
// ONE-WAY invariant `originator (UserID) IS NOT NULL ⟹ accountable == originator`.
// When UserID is NULL the two MAY diverge (owner_fallback names an accountable
// human while authorization carries none), so the invariant only constrains the
// valid-originator direction. finalizeAttribution centralizes this; the test
// guards against a future Classify path forgetting to route through it.
//
// Since MUL-6951 trigger_owner is NOT in that divergent set — an armed autopilot
// carries its trigger creator's authorization — so it is excluded from the
// allow-list below and the check proves it populates the originator. rule_owner
// stays divergent on purpose: it is a guess at who owns a rule, and must never
// become an authorization identity (Elon review).
func TestAccountableMirrorsOriginatorInvariant(t *testing.T) {
	results := []Result{
		DirectHumanRun(human, EvidenceChat, chat),
		DirectHumanRun(pgtype.UUID{}, "", pgtype.UUID{}),
		Unattributed(EvidenceAutopilotRun, srcTask),
		RuleOwner(human, ruleVer, EvidenceAutopilotRun, srcTask),         // divergent: accountable set, originator NULL
		RuleOwner(pgtype.UUID{}, ruleVer, EvidenceAutopilotRun, srcTask), // no publisher → unattributed
		TriggerOwner(human, EvidenceAutopilotRun, srcTask),               // originator = trigger owner (MUL-6951)
		TriggerOwner(pgtype.UUID{}, EvidenceAutopilotRun, srcTask),       // no owner → unattributed
	}
	for i, r := range results {
		// One-way invariant: a valid originator must equal accountable.
		if r.UserID.Valid && r.AccountableUserID != r.UserID {
			t.Errorf("result[%d]: originator %v valid but accountable %v differs — invariant violated", i, r.UserID, r.AccountableUserID)
		}
		// Authorization must never be forged from the audit side: a non-NULL
		// accountable with a NULL originator is allowed (divergence), but the
		// reverse — originator set from accountable — must never happen implicitly.
		if r.AccountableUserID.Valid && !r.UserID.Valid &&
			r.Source != SourceOwnerFallback && r.Source != SourceRuleOwner {
			t.Errorf("result[%d]: accountable set with NULL originator only allowed for delegation/chat_source/rule_owner/owner_fallback, got source=%q", i, r.Source)
		}
	}
}

func TestDirectHumanRun(t *testing.T) {
	got := DirectHumanRun(human, EvidenceChat, chat)
	if got.Source != SourceDirectHuman || got.UserID != human || got.AccountableUserID != human {
		t.Errorf("valid member should be a direct_human originator+accountable, got %+v", got)
	}
	if got.EvidenceKind != EvidenceChat || got.EvidenceRefID != chat {
		t.Errorf("evidence should be carried through")
	}

	unresolved := DirectHumanRun(pgtype.UUID{}, "", pgtype.UUID{})
	if unresolved.Source != SourceUnattributed {
		t.Errorf("invalid user must degrade to unattributed, got %q", unresolved.Source)
	}
	if unresolved.UserID.Valid || unresolved.AccountableUserID.Valid {
		t.Errorf("invalid user must not fabricate a human")
	}
}

func TestRuleOwner(t *testing.T) {
	// The divergent case, and deliberately so (MUL-6951, Elon review): the rule
	// publisher never armed anything, so it is accountable for audit but carries no
	// authorization. A run that lands here fails the invoke gate closed.
	got := RuleOwner(human, ruleVer, EvidenceAutopilotRun, srcTask)
	if got.Source != SourceRuleOwner {
		t.Fatalf("source = %q, want rule_owner", got.Source)
	}
	if got.UserID.Valid {
		t.Errorf("rule_owner must NOT set originator (authorization stays NULL), got %v", got.UserID)
	}
	if got.AccountableUserID != human {
		t.Errorf("accountable should be the rule publisher, got %v", got.AccountableUserID)
	}
	if got.RuleVersionID != ruleVer {
		t.Errorf("rule_version_id = %v, want %v", got.RuleVersionID, ruleVer)
	}
	if got.EvidenceKind != EvidenceAutopilotRun || got.EvidenceRefID != srcTask {
		t.Errorf("evidence should be carried through")
	}

	// No publisher (system-published / unresolved) must not fabricate a human.
	none := RuleOwner(pgtype.UUID{}, ruleVer, EvidenceAutopilotRun, srcTask)
	if none.Source != SourceUnattributed {
		t.Errorf("missing publisher must degrade to unattributed, got %q", none.Source)
	}
	if none.UserID.Valid || none.AccountableUserID.Valid {
		t.Errorf("missing publisher must carry no human on either side")
	}
}

func TestTriggerOwner(t *testing.T) {
	// MUL-4302 (Bohan) resolves the trigger's human; MUL-6951 makes the trigger
	// CREATOR the run's ORIGINATOR, so a scheduled fire carries the same
	// authorization their manual "run now" would.
	got := TriggerOwner(human, EvidenceAutopilotRun, srcTask)
	if got.Source != SourceTriggerOwner {
		t.Fatalf("source = %q, want trigger_owner", got.Source)
	}
	if !got.Source.Precise() {
		t.Errorf("trigger_owner must be a precise source")
	}
	if got.UserID != human {
		t.Errorf("originator should be the trigger creator, got %v", got.UserID)
	}
	if got.AccountableUserID != human {
		t.Errorf("accountable should be the trigger creator, got %v", got.AccountableUserID)
	}
	if got.EvidenceKind != EvidenceAutopilotRun || got.EvidenceRefID != srcTask {
		t.Errorf("evidence should be carried through")
	}

	// No creator (unrecoverable) must not fabricate a human — degrades to
	// unattributed so the caller can fall back to rule_owner.
	none := TriggerOwner(pgtype.UUID{}, EvidenceAutopilotRun, srcTask)
	if none.Source != SourceUnattributed {
		t.Errorf("missing creator must degrade to unattributed, got %q", none.Source)
	}
	if none.UserID.Valid || none.AccountableUserID.Valid {
		t.Errorf("missing creator must carry no human on either side")
	}
}

func TestOwnerFallback(t *testing.T) {
	// Unattributed → owner_fallback: accountable = owner, originator stays NULL,
	// source is degraded (not precise).
	base := Unattributed(EvidenceChat, srcTask)
	got := OwnerFallback(base, other)
	if got.Source != SourceOwnerFallback {
		t.Fatalf("source = %q, want owner_fallback", got.Source)
	}
	if got.Source.Precise() {
		t.Errorf("owner_fallback must be a degraded (non-precise) source")
	}
	if got.UserID.Valid {
		t.Errorf("owner_fallback is audit-only; originator must stay NULL")
	}
	if got.AccountableUserID != other {
		t.Errorf("accountable = %v, want owner %v", got.AccountableUserID, other)
	}

	// Precise results are untouched.
	precise := DirectHumanRun(human, EvidenceChat, chat)
	if OwnerFallback(precise, other) != precise {
		t.Errorf("owner_fallback must not alter a precise attribution")
	}

	// Invalid owner → stays unattributed, never fabricates a human.
	noOwner := OwnerFallback(Unattributed(EvidenceChat, srcTask), pgtype.UUID{})
	if noOwner.Source != SourceUnattributed || noOwner.AccountableUserID.Valid {
		t.Errorf("invalid owner must leave the result unattributed with no human, got %+v", noOwner)
	}
}

func TestUnattributed(t *testing.T) {
	got := Unattributed(EvidenceAutopilotRun, srcTask)
	if got.Source != SourceUnattributed {
		t.Fatalf("source = %q, want unattributed", got.Source)
	}
	if got.UserID.Valid || got.AccountableUserID.Valid {
		t.Errorf("unattributed must carry no human on either side")
	}
	if got.EvidenceKind != EvidenceAutopilotRun || got.EvidenceRefID != srcTask {
		t.Errorf("evidence should be carried so the row is not a NULL-source bypass")
	}
}

func TestSourcePrecise(t *testing.T) {
	precise := []Source{SourceDirectHuman, SourceTriggerOwner, SourceRuleOwner}
	degraded := []Source{SourceOwnerFallback, SourceUnattributed, Source("")}
	for _, s := range precise {
		if !s.Precise() {
			t.Errorf("%q should be precise", s)
		}
	}
	for _, s := range degraded {
		if s.Precise() {
			t.Errorf("%q should be degraded", s)
		}
	}
}

func TestSourceStringDefaultsToUnattributed(t *testing.T) {
	if Source("").String() != string(SourceUnattributed) {
		t.Errorf("empty source must stringify to unattributed, got %q", Source("").String())
	}
	if SourceDirectHuman.String() != "direct_human" {
		t.Errorf("unexpected string for direct_human: %q", SourceDirectHuman.String())
	}
}
