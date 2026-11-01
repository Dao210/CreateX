package handler

import (
	"context"
	"testing"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestUnsetIDFallsBackToTheDatabaseDefault covers the safety net: a caller that
// does not mint an id must still get a row, with a database-generated v4, rather
// than a NOT NULL violation. This is what makes the COALESCE wrapper — and
// dbid.NewV7's silent degradation on an entropy failure — safe.
func TestUnsetIDFallsBackToTheDatabaseDefault(t *testing.T) {
	ctx := context.Background()

	issueID := dbfx.Issue(t, "uuidv7 fallback issue")
	created, err := testHandler.Queries.CreateActivity(ctx, db.CreateActivityParams{
		WorkspaceID: parseUUID(testWorkspaceID),
		IssueID:     parseUUID(issueID),
		ActorType:   pgtype.Text{String: "member", Valid: true},
		ActorID:     parseUUID(testUserID),
		Action:      "uuidv7_fallback_test",
		Details:     []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("CreateActivity without an id: %v", err)
	}
	cleanupRow(t, "activity_log", created.ID)

	if !created.ID.Valid {
		t.Fatal("row was inserted without an id")
	}
	if v := uuid.UUID(created.ID.Bytes).Version(); v != 4 {
		t.Fatalf("database default produced a v%d id, want v4", v)
	}
}

func assertV7(t *testing.T, label string, id pgtype.UUID) {
	t.Helper()

	if !id.Valid {
		t.Fatalf("%s: no id returned", label)
	}
	parsed := uuid.UUID(id.Bytes)
	if v := parsed.Version(); v != 7 {
		t.Errorf("%s: stored id is v%d (%s), want v7", label, v, parsed)
	}
}

// cleanupRow deletes a row the query under test created. Fixtures registered
// through testutil clean themselves up; rows created by the production query do
// not, so they are registered by hand.
func cleanupRow(t *testing.T, table string, id pgtype.UUID) {
	t.Helper()

	dbfx.Cleanup(t, `DELETE FROM `+table+` WHERE id = $1`, id)
}
