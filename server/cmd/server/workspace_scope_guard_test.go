package main

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/auro-ai/auro/server/internal/util"
)

// ---- seed helpers (resource lives in testWorkspaceID) ----

func seedSkill(t *testing.T, ctx context.Context) pgtype.UUID {
	t.Helper()
	var s string
	// skill name is UNIQUE per workspace; add a random suffix to avoid colliding
	// with previous runs on the same DB.
	name := uniqueName("scope-guard skill")
	if err := testPool.QueryRow(ctx, `
		INSERT INTO skill (workspace_id, name, description, content, config, created_by)
		VALUES ($1, $2, '', '', '{}'::jsonb, $3)
		RETURNING id
	`, testWorkspaceID, name, testUserID).Scan(&s); err != nil {
		t.Fatalf("seed skill: %v", err)
	}
	return parseUUID(s)
}

func seedChatSession(t *testing.T, ctx context.Context) pgtype.UUID {
	t.Helper()
	var agentID string
	if err := testPool.QueryRow(ctx, `
		SELECT id FROM agent WHERE workspace_id = $1 LIMIT 1
	`, testWorkspaceID).Scan(&agentID); err != nil {
		t.Fatalf("find test agent: %v", err)
	}
	var s string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO chat_session (workspace_id, agent_id, creator_id, title, runtime_id)
		VALUES ($1, $2, $3, 'scope-guard chat', (SELECT runtime_id FROM agent WHERE id = $2))
		RETURNING id
	`, testWorkspaceID, agentID, testUserID).Scan(&s); err != nil {
		t.Fatalf("seed chat_session: %v", err)
	}
	return parseUUID(s)
}

func assertRowExists(t *testing.T, ctx context.Context, table string, id pgtype.UUID) {
	t.Helper()
	var count int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE id = $1`, util.UUIDToString(id)).Scan(&count); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	if count != 1 {
		t.Fatalf("row in %s was removed across workspace boundary (count = %d)", table, count)
	}
}

// randomUUID returns a never-existed workspace UUID for cross-tenant probes.
func randomUUID(t *testing.T) pgtype.UUID {
	t.Helper()
	u, err := uuid.NewRandom()
	if err != nil {
		t.Fatalf("uuid.NewRandom: %v", err)
	}
	return parseUUID(u.String())
}

// uniqueName returns prefix + a short random suffix to avoid UNIQUE collisions
// across reruns on the same database.
func uniqueName(prefix string) string {
	u, err := uuid.NewRandom()
	if err != nil {
		return prefix
	}
	return prefix + "-" + u.String()[:8]
}
