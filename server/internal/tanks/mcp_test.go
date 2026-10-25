package tanks

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/auro-ai/auro/server/internal/mcpadmin"
	"github.com/auro-ai/auro/server/internal/testutil"
)

func TestTankMCPProtocolAndReadTools(t *testing.T) {
	h := (&HTTP{AllowedOrigins: []string{"http://localhost:13440"}, Control: &testMCPControl{policy: mcpadmin.DefaultPolicy(MCPServiceID)}}).Handler()
	request := func(body string) *http.Request {
		r := testutil.JSONRequest(http.MethodPost, "/api/tanks/mcp", body)
		r.Header.Set("Accept", "application/json, text/event-stream")
		return r.WithContext(WithActor(r.Context(), Actor{WorkspaceID: "workspace", UserID: "user"}))
	}
	var out map[string]any
	testutil.Call(t, h.ServeHTTP, request(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`)).Want(200).JSON(&out)
	if out["result"].(map[string]any)["protocolVersion"] != ProtocolVersion {
		t.Fatalf("initialize=%v", out)
	}
	testutil.Call(t, h.ServeHTTP, request(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)).Want(202)
	testutil.Call(t, h.ServeHTTP, request(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)).Want(200).JSON(&out)
	if len(out["result"].(map[string]any)["tools"].([]any)) != 8 {
		t.Fatalf("tools=%v", out)
	}
	testutil.Call(t, h.ServeHTTP, request(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tank_get_catalog","arguments":{}}}`)).Want(200).JSON(&out)
	result := out["result"].(map[string]any)
	if result["structuredContent"].(map[string]any)["profile"] != "tank-defense@1" {
		t.Fatalf("catalog=%v", out)
	}
	for _, tc := range []struct {
		body      string
		toolError bool
	}{{`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"tank_save_character","arguments":{"requestId":"bad","draft":{"speed":9999}}}}`, true}, {`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"tank_validate_character","arguments":{}}}`, false}} {
		testutil.Call(t, h.ServeHTTP, request(tc.body)).Want(200).JSON(&out)
		r := out["result"].(map[string]any)
		if tc.toolError {
			if r["isError"] != true || r["structuredContent"] != nil {
				t.Fatalf("tool error=%v", out)
			}
		} else if r["structuredContent"] != nil && r["structuredContent"].(map[string]any)["valid"] == true {
			t.Fatalf("empty draft was valid: %v", out)
		}
	}
	for _, body := range []string{`{"jsonrpc":"2.0","id":null,"method":"tools/list"}`, `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"unknown"}}`, `{"jsonrpc":"2.0","id":7,"method":"unknown"}`, `{"jsonrpc":"2.0","id":8,"method":"tools/list","method":"ping"}`} {
		testutil.Call(t, h.ServeHTTP, request(body)).Want(200).JSON(&out)
		if out["error"] == nil {
			t.Fatalf("expected protocol error: %v", out)
		}
	}
	r := request(`{"jsonrpc":"2.0","id":9,"method":"tools/list"}`)
	r.Header.Set("Origin", "https://evil.invalid")
	testutil.Call(t, h.ServeHTTP, r).Want(403)
	r = request(`{}`)
	r.Header.Set("Accept", "application/json")
	testutil.Call(t, h.ServeHTTP, r).Want(406)
	testutil.Call(t, h.ServeHTTP, testutil.JSONRequest(http.MethodPost, "/api/tanks/mcp", `{}`)).Want(401)
	r = request(`{}`)
	r.Method = http.MethodGet
	testutil.Call(t, h.ServeHTTP, r).Want(405)
}

type testMCPControl struct {
	policy mcpadmin.Policy
	err    error
	calls  []mcpadmin.Call
}

func (c *testMCPControl) Policy(context.Context, string) (mcpadmin.Policy, error) {
	return c.policy, c.err
}
func (c *testMCPControl) RecordCall(_ context.Context, call mcpadmin.Call) error {
	c.calls = append(c.calls, call)
	return nil
}

func TestTankMCPGlobalPolicy(t *testing.T) {
	for _, tc := range []struct {
		name     string
		enabled  bool
		disabled []string
		code     string
		count    int
	}{
		{"disabled service", false, []string{}, "mcp_service_disabled", 0},
		{"disabled tool", true, []string{"tank_get_catalog"}, "mcp_tool_disabled", 7},
	} {
		t.Run(tc.name, func(t *testing.T) {
			control := &testMCPControl{policy: mcpadmin.Policy{ServiceID: MCPServiceID, Enabled: tc.enabled, DisabledTools: tc.disabled}}
			h := (&HTTP{Control: control}).Handler()
			request := func(body string) *http.Request {
				r := testutil.JSONRequest(http.MethodPost, "/api/tanks/mcp", body)
				r.Header.Set("Accept", "application/json, text/event-stream")
				return r.WithContext(WithActor(r.Context(), Actor{WorkspaceID: "workspace", UserID: "user"}))
			}
			var out map[string]any
			testutil.Call(t, h.ServeHTTP, request(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)).Want(200).JSON(&out)
			if len(out["result"].(map[string]any)["tools"].([]any)) != tc.count {
				t.Fatalf("list=%v", out)
			}
			testutil.Call(t, h.ServeHTTP, request(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tank_get_catalog","arguments":{}}}`)).Want(200).JSON(&out)
			if out["result"].(map[string]any)["isError"] != true || len(control.calls) != 1 || control.calls[0].Outcome != "blocked" || control.calls[0].ErrorCode != tc.code {
				t.Fatalf("result=%v, calls=%+v", out, control.calls)
			}
		})
	}
}
func TestTankMCPUnavailablePolicyFailsClosed(t *testing.T) {
	control := &testMCPControl{err: errors.New("database unavailable")}
	h := (&HTTP{Control: control}).Handler()
	r := testutil.JSONRequest(http.MethodPost, "/api/tanks/mcp", `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tank_get_catalog","arguments":{}}}`)
	r.Header.Set("Accept", "application/json, text/event-stream")
	r = r.WithContext(WithActor(r.Context(), Actor{WorkspaceID: "workspace", UserID: "user"}))
	var out map[string]any
	testutil.Call(t, h.ServeHTTP, r).Want(200).JSON(&out)
	if out["result"].(map[string]any)["isError"] != true || control.calls[0].ErrorCode != "mcp_policy_unavailable" {
		t.Fatalf("result=%v", out)
	}
}
