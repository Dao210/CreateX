package handler

import (
	"fmt"
	"testing"
)

// MUL-5824: cancelled work is abandoned work. It stays reachable, but it must
// never sit above a live issue on relevance alone — and it must be what the
// LIMIT window drops first, not what pushes live work off the page.
//
// These run the real handler against the real SQL. The string assertions in
// search_test.go only prove the ORDER BY was assembled in the intended shape;
// they cannot show Postgres actually sorts this way.

func assertOrder(t *testing.T, q string, got, want []string) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("search(%q) order = %v, want %v", q, got, want)
	}
}
