package handler

import (
	"github.com/auro-ai/auro/server/internal/util"
	"github.com/jackc/pgx/v5/pgtype"
)

// Helper to build a pgtype.UUID from a string.
func testUUID(s string) pgtype.UUID {
	return parseUUID(s)
}

// Helper to build a pgtype.Text.
func testText(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: true}
}

const (
	agentAssigneeID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	otherAgentID    = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	memberID        = "cccccccc-cccc-cccc-cccc-cccccccccccc"
	otherMemberID   = "dddddddd-dddd-dddd-dddd-dddddddddddd"
)

func parseMentionsForTest(content string) []util.Mention {
	return util.ParseMentions(content)
}

// -------------------------------------------------------------------
// isNoteComment — the /note opt-out prefix
// -------------------------------------------------------------------
