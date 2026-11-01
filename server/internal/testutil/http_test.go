package testutil

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestJSONRequestEncodesValuesAndPassesRawBodiesThrough(t *testing.T) {
	t.Parallel()

	// A struct is encoded. A string is not: the malformed-payload tests the
	// endpoint checklist asks for send bodies that are not valid JSON, and
	// encoding them would turn every one of those into a well-formed string
	// literal that the handler happily parses.
	tests := []struct {
		name string
		body any
		want string
	}{
		{"map", map[string]any{"a": 1}, `{"a":1}`},
		{"string passthrough", `{"broken":`, `{"broken":`},
		{"bytes passthrough", []byte("not json"), "not json"},
		{"reader passthrough", strings.NewReader("streamed"), "streamed"},
		{"nil is empty", nil, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := JSONRequest("POST", "/api/thing", tt.body)
			got, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("read body: %v", err)
			}
			if strings.TrimSpace(string(got)) != tt.want {
				t.Fatalf("body = %q, want %q", got, tt.want)
			}
			if ct := req.Header.Get("Content-Type"); ct != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json", ct)
			}
		})
	}
}

func TestWithHeadersSetsPairs(t *testing.T) {
	t.Parallel()

	req := WithHeaders(JSONRequest("GET", "/api/me", nil), "X-User-ID", "u1", "X-Workspace-ID", "w1")
	if got := req.Header.Get("X-User-ID"); got != "u1" {
		t.Fatalf("X-User-ID = %q, want u1", got)
	}
	if got := req.Header.Get("X-Workspace-ID"); got != "w1" {
		t.Fatalf("X-Workspace-ID = %q, want w1", got)
	}
}

// TestWantReportsTheBodyOnMismatch pins the one thing the shared assertion has
// to keep doing: a handler that rejects a request says which rejection fired
// in the body, and a helper that swallowed it would make every 400 look alike.
func TestWantReportsTheBodyOnMismatch(t *testing.T) {
	t.Parallel()

	h := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"slug is reserved"}`))
	}

	spy := &spyTB{}
	spy.capture(func() {
		Call(spy, h, JSONRequest("POST", "/api/workspaces", nil)).Want(http.StatusCreated)
	})

	if !spy.failed {
		t.Fatal("Want did not fail on a status mismatch")
	}
	for _, want := range []string{"POST", "/api/workspaces", "expected 201", "got 400", "slug is reserved"} {
		if !strings.Contains(spy.message, want) {
			t.Fatalf("failure message %q missing %q", spy.message, want)
		}
	}
}

// spyTB stands in for *testing.T so a test can assert on what a failing helper
// reports. Fatalf panics because the real one ends the goroutine, and a helper
// that kept running past its own Fatalf would read as passing here.
type spyTB struct {
	failed  bool
	message string
}

type spyFatal struct{}

func (s *spyTB) Helper()        {}
func (s *spyTB) Cleanup(func()) {}

func (s *spyTB) Fatalf(format string, args ...any) {
	s.failed = true
	s.message = fmt.Sprintf(format, args...)
	panic(spyFatal{})
}

func (s *spyTB) capture(fn func()) {
	defer func() {
		if r := recover(); r != nil {
			if _, ok := r.(spyFatal); !ok {
				panic(r)
			}
		}
	}()
	fn()
}

func TestWantOneOfAcceptsAnyListedStatus(t *testing.T) {
	t.Parallel()

	h := func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusConflict) }
	Call(t, h, JSONRequest("POST", "/api/tasks", nil)).WantOneOf(http.StatusOK, http.StatusConflict)
}
