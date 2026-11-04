package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLifeReadinessSeparatesRuntimeFailureFromUninitializedWorld(t *testing.T) {
	for _, state := range []string{"running", "uninitialized", "starting", "error", "stopped"} {
		t.Run(state, func(t *testing.T) {
			h := &serverHealth{db: &stubReadinessDB{appliedCount: 1}, requiredMigrations: []string{"baseline"}, lifeStatus: func() string { return state }}
			out := httptest.NewRecorder()
			h.readyHandler(out, httptest.NewRequest(http.MethodGet, "/readyz", nil))
			want := http.StatusServiceUnavailable
			if state == "running" || state == "uninitialized" {
				want = http.StatusOK
			}
			if out.Code != want {
				t.Fatalf("state=%s readiness=%d want=%d", state, out.Code, want)
			}
			live := httptest.NewRecorder()
			h.liveHandler(live, httptest.NewRequest(http.MethodGet, "/health", nil))
			if live.Code != 200 {
				t.Fatal("simulation error hid main process liveness")
			}
		})
	}
}
