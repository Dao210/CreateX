package handler

import (
	"strings"
	"testing"

	"github.com/auro-ai/auro/server/internal/testutil"
)

// assertDenialReason decodes a rejection body and compares its `error` sentence
// to the one the CALLER states it expects, then checks a property that holds for
// every invoke denial: the sentence must not name the target's permission mode.
//
// The expected sentence stays an argument on purpose — the test making the claim
// keeps it. What the helper contributes is the leak scan, which is the same
// property in every case and is exactly what a status-only assertion missed:
// before MUL-6380 these endpoints answered "cannot assign to private agent",
// disclosing the mode to a caller just told they may not use the target, and
// mislabelling a `public_to` agent scoped to specific people as private.
func assertDenialReason(t *testing.T, resp *testutil.Response, want string) {
	t.Helper()
	var body struct {
		Error string `json:"error"`
	}
	resp.JSON(&body)
	if body.Error != want {
		t.Fatalf("denial reason = %q, want %q", body.Error, want)
	}
	for _, mode := range []string{"private", "public_to", "allow-list"} {
		if strings.Contains(strings.ToLower(body.Error), mode) {
			t.Fatalf("denial reason names the target's permission mode (%q): %q", mode, body.Error)
		}
	}
}
