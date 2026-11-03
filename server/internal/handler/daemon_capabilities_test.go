package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/auro-ai/auro/server/pkg/protocol"
)

// The bridge the whole gate rests on: what the daemon advertises on the
// register request has to survive onto the runtime row, or the save gate and
// the UI read an empty capability list and refuse a machine that is perfectly
// capable. Drives the real DaemonRegister handler.
func TestDaemonRegisterPersistsCapabilities(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	const daemonID = "capability-roundtrip-daemon"

	register := func(t *testing.T, capabilities string) string {
		t.Helper()
		w := httptest.NewRecorder()
		req := newDaemonTokenRequest("POST", "/api/daemon/register", map[string]any{
			"workspace_id": testWorkspaceID,
			"daemon_id":    daemonID,
			"device_name":  "capability-roundtrip-device",
			"runtimes": []map[string]any{
				{"name": "cap-runtime", "type": "claude", "version": "1.0.0", "status": "online"},
			},
		}, testWorkspaceID, daemonID)
		if capabilities != "" {
			req.Header.Set("X-Client-Capabilities", capabilities)
		} else {
			req.Header.Del("X-Client-Capabilities")
		}
		testHandler.DaemonRegister(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("DaemonRegister: expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var resp map[string]any
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		runtimes, ok := resp["runtimes"].([]any)
		if !ok || len(runtimes) == 0 {
			t.Fatalf("expected runtimes in response, got %v", resp)
		}
		id := runtimes[0].(map[string]any)["id"].(string)
		t.Cleanup(func() { testPool.Exec(ctx, `DELETE FROM agent_runtime WHERE id = $1`, id) })
		return id
	}

	assertCapable := func(t *testing.T, runtimeID string, want bool) {
		t.Helper()
		var metadata []byte
		if err := testPool.QueryRow(ctx,
			`SELECT metadata FROM agent_runtime WHERE id = $1`, runtimeID).Scan(&metadata); err != nil {
			t.Fatalf("read metadata: %v", err)
		}
		if got := func() bool {
			var decoded struct {
				Capabilities []string `json:"capabilities"`
			}
			if err := json.Unmarshal(metadata, &decoded); err != nil {
				t.Fatal(err)
			}
			return slices.Contains(decoded.Capabilities, protocol.DaemonCapabilityLocalWorktreeV1)
		}(); got != want {
			t.Errorf("capability persisted = %v, want %v (metadata: %s)", got, want, metadata)
		}
	}

	t.Run("advertised capability lands on the row", func(t *testing.T) {
		id := register(t, protocol.DaemonCapabilitySkillBundlesV1+","+protocol.DaemonCapabilityLocalWorktreeV1)
		assertCapable(t, id, true)
	})

	// An older daemon sends no header at all. Re-registering must overwrite the
	// row rather than leave a capable-looking one behind — that is precisely the
	// downgrade the save gate has to notice.
	t.Run("re-registering without the header clears it", func(t *testing.T) {
		id := register(t, protocol.DaemonCapabilitySkillBundlesV1+","+protocol.DaemonCapabilityLocalWorktreeV1)
		assertCapable(t, id, true)

		again := register(t, "")
		if again != id {
			t.Fatalf("expected the same runtime row on re-register, got %s then %s", id, again)
		}
		assertCapable(t, id, false)
	})
}
