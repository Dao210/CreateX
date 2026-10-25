package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTankMCPStdioUsesBoundCredentialsAndNotificationSemantics(t *testing.T) {
	var calls int
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/tanks/mcp" || r.Header.Get("Authorization") != "Bearer mat_test-only" || r.Header.Get("X-Workspace-ID") != "workspace-test" {
			t.Errorf("unexpected MCP request %s headers=%v", r.URL.Path, r.Header)
		}
		if r.Header.Get("Accept") != "application/json, text/event-stream" {
			t.Error("missing MCP accept")
		}
		var in struct {
			ID json.RawMessage `json:"id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		if len(in.ID) == 0 {
			w.WriteHeader(202)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": in.ID, "result": map[string]any{"ok": true}})
	}))
	defer s.Close()
	c := NewAPIClient(s.URL, "workspace-test", "mat_test-only")
	var output bytes.Buffer
	input := strings.NewReader("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}\n")
	if e := c.ServeTankMCP(context.Background(), input, &output); e != nil {
		t.Fatal(e)
	}
	if calls != 3 || len(strings.Split(strings.TrimSpace(output.String()), "\n")) != 2 {
		t.Fatalf("calls=%d output=%s", calls, output.String())
	}
	if strings.Contains(output.String(), "mat_test-only") {
		t.Fatal("credential leaked to stdout")
	}
}
func TestTankMCPStdioDoesNotFallBackToAnotherAccount(t *testing.T) {
	for _, c := range []*APIClient{NewAPIClient("http://example.invalid", "workspace", ""), NewAPIClient("http://example.invalid", "", "mat_test-only")} {
		if e := c.ServeTankMCP(context.Background(), strings.NewReader(""), io.Discard); e == nil {
			t.Fatal("missing identity accepted")
		}
	}
}
