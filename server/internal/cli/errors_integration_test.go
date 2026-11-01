package cli

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestCommandContextNotTruncatedBelowHTTPTimeout proves the must-fix: a
// command-level context derived from APIContext never cancels a request before
// the configured transport timeout. Previously commands hardcoded a 15s
// context that truncated a longer AURO_HTTP_TIMEOUT.
func TestCommandContextNotTruncatedBelowHTTPTimeout(t *testing.T) {
	withLang(t, "en_US.UTF-8")
	// Use a short transport timeout so the test runs fast; the command budget
	// (transport + grace) is what we assert is NOT the limiting factor.
	t.Setenv("AURO_HTTP_TIMEOUT", "400ms")

	if APITimeout() <= httpTimeout() {
		t.Fatalf("APITimeout (%v) must be strictly greater than httpTimeout (%v)", APITimeout(), httpTimeout())
	}

	t.Run("request within transport budget completes (context does not fire first)", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(120 * time.Millisecond) // < 400ms transport timeout
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
		}))
		defer srv.Close()

		client := NewAPIClient(srv.URL, "", "")
		ctx, cancel := APIContext(context.Background())
		defer cancel()

		var out map[string]string
		if err := client.GetJSON(ctx, "/x", &out); err != nil {
			t.Fatalf("expected success within transport budget, got %v", err)
		}
	})

	t.Run("transport timeout governs and yields a friendly timeout error", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(900 * time.Millisecond) // > 400ms transport timeout
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		client := NewAPIClient(srv.URL, "", "")
		ctx, cancel := APIContext(context.Background())
		defer cancel()

		start := time.Now()
		err := client.GetJSON(ctx, "/x", nil)
		elapsed := time.Since(start)

		if err == nil {
			t.Fatal("expected a timeout error")
		}
		// Must fail near the 400ms transport timeout, not the ~5.4s command
		// context deadline. A generous 3s ceiling keeps the test non-flaky
		// while still proving the context did not govern.
		if elapsed > 3*time.Second {
			t.Errorf("request took %v; the command context likely truncated/governed instead of the transport timeout", elapsed)
		}
		if msg := FormatError(err, false); !strings.Contains(msg, "timed out") {
			t.Errorf("expected friendly timeout copy, got %q", msg)
		}
		if got := ExitCodeFor(err); got != ExitNetwork {
			t.Errorf("ExitCodeFor = %d, want ExitNetwork(%d)", got, ExitNetwork)
		}
	})
}

// TestAPITimeoutRespectsEnv verifies the command budget tracks
// AURO_HTTP_TIMEOUT and the AtLeast floor.
func TestAPITimeoutRespectsEnv(t *testing.T) {
	t.Run("default", func(t *testing.T) {
		t.Setenv("AURO_HTTP_TIMEOUT", "")
		if got, want := APITimeout(), defaultHTTPTimeout+apiContextGrace; got != want {
			t.Errorf("APITimeout = %v, want %v", got, want)
		}
	})
	t.Run("env override raises both transport and command budget", func(t *testing.T) {
		t.Setenv("AURO_HTTP_TIMEOUT", "90s")
		if got, want := APITimeout(), 90*time.Second+apiContextGrace; got != want {
			t.Errorf("APITimeout = %v, want %v", got, want)
		}
	})
	t.Run("AtLeast floor wins when larger", func(t *testing.T) {
		t.Setenv("AURO_HTTP_TIMEOUT", "10s")
		if got, want := AtLeastAPITimeout(60*time.Second), 60*time.Second; got != want {
			t.Errorf("AtLeastAPITimeout = %v, want %v", got, want)
		}
	})
	t.Run("AtLeast budget wins when larger than floor", func(t *testing.T) {
		t.Setenv("AURO_HTTP_TIMEOUT", "120s")
		if got, want := AtLeastAPITimeout(60*time.Second), 120*time.Second+apiContextGrace; got != want {
			t.Errorf("AtLeastAPITimeout = %v, want %v", got, want)
		}
	})
	// The login workspace-creation poll uses a short 10s floor to stay
	// responsive, but it must still honor AURO_HTTP_TIMEOUT (it is not a
	// silent exception to the env-override promise). With the env unset the
	// budget is at least the 10s floor; with the env raised it scales up.
	t.Run("login poll 10s floor honors env override", func(t *testing.T) {
		t.Setenv("AURO_HTTP_TIMEOUT", "")
		if got := AtLeastAPITimeout(10 * time.Second); got < 10*time.Second {
			t.Errorf("AtLeastAPITimeout(10s) = %v, want >= 10s floor", got)
		}
		t.Setenv("AURO_HTTP_TIMEOUT", "90s")
		if got, want := AtLeastAPITimeout(10*time.Second), 90*time.Second+apiContextGrace; got != want {
			t.Errorf("AtLeastAPITimeout(10s) with env=90s = %v, want %v", got, want)
		}
	})
}
