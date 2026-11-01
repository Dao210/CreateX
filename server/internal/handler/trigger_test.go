package handler

import (
	"testing"

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

func TestIsNoteComment(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    bool
	}{
		{"plain comment triggers", "just a plain comment", false},
		{"note prefix skips", "/note check the API expiry", true},
		{"bare note skips", "/note", true},
		{"uppercase note skips (case-insensitive)", "/NOTE shout", true},
		{"mixed case note skips", "/Note mixed", true},
		{"leading whitespace tolerated", "   /note leading space", true},
		{"note followed by newline skips", "/note\nmultiline body", true},
		{"plural notes does not match (word boundary)", "/notes are plural", false},
		{"noteworthy does not match", "/noteworthy idea", false},
		{"slash space note does not match", "/ note has a space", false},
		{"mid-sentence note does not match", "see foo/note here", false},
		{"note as second token does not match", "fyi /note", false},
		{"empty content does not match", "", false},
		{"whitespace-only content does not match", "   ", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isNoteComment(tt.content); got != tt.want {
				t.Errorf("isNoteComment(%q) = %v, want %v", tt.content, got, tt.want)
			}
		})
	}
}
