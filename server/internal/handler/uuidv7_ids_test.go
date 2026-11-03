package handler

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

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
