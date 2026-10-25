package reach

import (
	"fmt"
	"testing"
	"time"
)

func enter(t *testing.T, w *World, id, name string, spec Spec) *Entity {
	t.Helper()
	normalized, fields := Normalize(spec)
	if len(fields) != 0 {
		t.Fatalf("entity %s invalid: %+v", id, fields)
	}
	e := &Entity{ID: id, Kind: spec.Kind, Name: name}
	w.Enter(e, normalized, spec)
	return e
}

func seededWorld(t *testing.T) *World {
	t.Helper()
	w := NewWorld("2026-S04", 42)
	enter(t, w, "e-1", "Rust Marshal", validCharacter())
	enter(t, w, "e-2", "Glass Runner", validCharacter())
	return w
}

func TestReplayIsDeterministic(t *testing.T) {
	a := seededWorld(t)
	b := seededWorld(t)
	for i := 0; i < 300; i++ {
		a.Step()
		b.Step()
		if a.Digest() != b.Digest() {
			t.Fatalf("digest diverged at beat %d: %s vs %s", i+1, a.Digest(), b.Digest())
		}
		if a.Beat != b.Beat || a.Version != b.Version {
			t.Fatalf("clock diverged at beat %d", i+1)
		}
	}
}

func TestTwoRunsAgreeOnEvents(t *testing.T) {
	a := seededWorld(t)
	b := seededWorld(t)
	for i := 0; i < 200; i++ {
		a.Step()
		b.Step()
	}
	if got, want := a.Snapshot(), b.Snapshot(); fmt.Sprint(got.Chronicle) != fmt.Sprint(want.Chronicle) {
		t.Fatal("chronicle must replay identically")
	}
}

func TestKillLeavesWreck(t *testing.T) {
	w := NewWorld("kill-test", 7)

	hunter := validCharacter()
	hunter.Name = "Hunter"
	hunter.Stats = Stats{Atk: 40, Tough: 20, Agi: 40, Sense: 0, Upkeep: 0}
	hunter.Loadout.Weapon = Weapon{
		Form: "blade", Dimensions: Dimensions{Length: 40, Mass: 20}, Material: "scrap", Trait: "none",
	}
	hunter.Policy = &Policy{Aggression: 1, Caution: 0, Hoard: 0, Loyalty: 0}

	prey := validCharacter()
	prey.Name = "Prey"
	prey.Stats = Stats{Atk: 0, Tough: 40, Agi: 0, Sense: 20, Upkeep: 40}
	prey.Policy = &Policy{Aggression: 0, Caution: 0, Hoard: 0, Loyalty: 0}

	h := enter(t, w, "hunter", "Hunter", hunter)
	p := enter(t, w, "prey", "Prey", prey)
	h.X, h.Y = 1000*Milli, 500*Milli
	p.X, p.Y = 1005*Milli, 500*Milli

	for i := 0; i < 60 && p.Status == StatusAlive; i++ {
		w.Step()
	}
	if p.Status != StatusDead {
		t.Fatalf("prey should be dead, hp=%d", p.HP)
	}
	if len(w.Wrecks) == 0 {
		t.Fatal("a death must leave a wreck")
	}
	if h.Kills == 0 {
		t.Fatal("killer must be credited")
	}
	if len(w.Chronicle) == 0 {
		t.Fatal("a kill must produce a chronicle entry")
	}
	if w.Chronicle[0].Kind != "first_blood" {
		t.Fatalf("first kill of the season is first blood, got %q", w.Chronicle[0].Kind)
	}
}

func TestChronicleIsBilingual(t *testing.T) {
	w := NewWorld("chron-test", 11)
	enter(t, w, "a", "Alpha", validCharacter())
	for i := 0; i < 300; i++ {
		w.Step()
	}
	if len(w.Chronicle) == 0 {
		t.Fatal("300 beats with one entity should still log upkeep deaths")
	}
	for _, c := range w.Chronicle {
		if c.Text.EN == "" || c.Text.ZH == "" {
			t.Fatalf("chronicle %d is missing a locale: %+v", c.Seq, c)
		}
	}
}

func TestFeedCursorIsStableAcrossTrimming(t *testing.T) {
	w := NewWorld("feed-test", 3)
	for i := 0; i < 20; i++ {
		enter(t, w, fmt.Sprintf("f-%d", i), fmt.Sprintf("Runner %d", i), validCharacter())
	}
	for i := 0; i < 200; i++ {
		w.Step()
	}
	first, cursor := w.Feed(0, 5)
	if len(first) != 5 {
		t.Fatalf("expected 5 entries, got %d", len(first))
	}
	second, _ := w.Feed(cursor, 5)
	if len(second) != 0 && second[0].Seq <= cursor {
		t.Fatal("cursor must not repeat entries")
	}
}

func TestSnapshotCapsHealthReadout(t *testing.T) {
	w := seededWorld(t)
	for i := 0; i < 10; i++ {
		w.Step()
	}
	for _, view := range w.Snapshot().Entities {
		if view.HP < 0 || view.HP > 100 {
			t.Fatalf("hp must be a percentage, got %d", view.HP)
		}
	}
}

// TestStepBudget guards the PRD's settlement budget: one beat for a full season
// population must stay well under the 200ms ceiling.
func TestStepBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("performance check")
	}
	w := NewWorld("budget", 5)
	for i := 0; i < 2000; i++ {
		spec := validCharacter()
		spec.Name = fmt.Sprintf("Runner %d", i)
		enter(t, w, fmt.Sprintf("b-%d", i), spec.Name, spec)
	}
	start := time.Now()
	for i := 0; i < 20; i++ {
		w.Step()
	}
	perBeat := time.Since(start) / 20
	t.Logf("2000 entities: %s per beat", perBeat)
	if perBeat > 200*time.Millisecond {
		t.Fatalf("beat took %s, budget is 200ms", perBeat)
	}
}
