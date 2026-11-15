package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCTFReadinessRequiresComputeBundle(t *testing.T) {
	for _, state := range []string{"ready", "unavailable"} {
		t.Run(state, func(t *testing.T) {
			h := &serverHealth{db: &stubReadinessDB{appliedCount: 1}, requiredMigrations: []string{"baseline"}, ctfStatus: func() string { return state }}
			ready := httptest.NewRecorder()
			h.readyHandler(ready, httptest.NewRequest(http.MethodGet, "/ready", nil))
			want := 200
			if state != "ready" {
				want = 503
			}
			if ready.Code != want {
				t.Fatalf("ctf=%s status=%d want=%d", state, ready.Code, want)
			}
			live := httptest.NewRecorder()
			h.liveHandler(live, httptest.NewRequest(http.MethodGet, "/health", nil))
			if live.Code != 200 {
				t.Fatal("CTF readiness hid process liveness")
			}
		})
	}
}
