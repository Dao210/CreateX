package siege

import (
	"testing"

	"github.com/google/uuid"
)

func TestListBlueprintsFlattensAndScopesSessions(t *testing.T) {
	store := newTestStore()
	owner := Owner{WorkspaceID: uuid.NewString(), UserID: uuid.NewString()}
	other := Owner{WorkspaceID: owner.WorkspaceID, UserID: uuid.NewString()}
	service := NewService(store, nil, "off", true, 0)
	first := &Session{ID: uuid.NewString(), OwnerHash: owner.Hash(), Blueprints: []Blueprint{
		{ID: uuid.NewString(), Name: "older", CreatedAt: "2026-10-01T00:00:00Z"},
		{ID: uuid.NewString(), Name: "newer", CreatedAt: "2026-10-03T00:00:00Z"},
	}}
	second := &Session{ID: uuid.NewString(), OwnerHash: owner.Hash(), Blueprints: []Blueprint{
		{ID: first.Blueprints[1].ID, Name: "duplicate", CreatedAt: "2026-10-03T00:00:00Z"},
		{ID: uuid.NewString(), Name: "middle", CreatedAt: "2026-10-02T00:00:00Z"},
	}}
	foreign := &Session{ID: uuid.NewString(), OwnerHash: other.Hash(), Blueprints: []Blueprint{
		{ID: uuid.NewString(), Name: "not mine", CreatedAt: "2026-10-04T00:00:00Z"},
	}}
	for _, session := range []*Session{first, second, foreign} {
		store.sessions[session.ID] = session
	}

	blueprints, err := service.ListBlueprints(owner)
	if err != nil {
		t.Fatal(err)
	}
	if len(blueprints) != 3 {
		t.Fatalf("blueprints=%+v", blueprints)
	}
	if blueprints[0].Name != "newer" || blueprints[1].Name != "middle" || blueprints[2].Name != "older" {
		t.Fatalf("order=%+v", blueprints)
	}
	if blueprints[0].SessionID != first.ID || blueprints[1].SessionID != second.ID {
		t.Fatalf("session ids=%+v", blueprints)
	}
}
