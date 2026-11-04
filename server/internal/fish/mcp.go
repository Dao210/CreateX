package fish

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/auro-ai/auro/server/internal/mcpadmin"
)

const ProtocolVersion = "2025-11-25"
const MCPServiceID = "auro-fish"

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Annotations map[string]any `json:"annotations"`
}

func object(properties map[string]any, required ...string) map[string]any {
	return map[string]any{"type": "object", "properties": properties, "required": append([]string{}, required...), "additionalProperties": false}
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

func rpcResult(w http.ResponseWriter, id json.RawMessage, result any) {
	send(w, 200, map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}
func rpcError(w http.ResponseWriter, id json.RawMessage, code int, message string) {
	send(w, 200, map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}})
}
func validID(raw json.RawMessage) bool {
	var value any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if e := d.Decode(&value); e != nil {
		return false
	}
	switch v := value.(type) {
	case string:
		return true
	case json.Number:
		_, e := strconv.ParseInt(v.String(), 10, 64)
		return e == nil
	}
	return false
}
func (h *HTTP) mcp(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" {
		allowed := false
		for _, v := range h.AllowedOrigins {
			if origin == v {
				allowed = true
			}
		}
		if !allowed {
			failure(w, problem("invalid_origin", 403))
			return
		}
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	accept := r.Header.Get("Accept")
	if !strings.Contains(accept, "application/json") || !strings.Contains(accept, "text/event-stream") {
		failure(w, problem("not_acceptable", 406))
		return
	}
	if v := r.Header.Get("MCP-Protocol-Version"); v != "" && v != ProtocolVersion && v != "2025-06-18" && v != "2025-03-26" {
		failure(w, problem("unsupported_protocol_version", 400))
		return
	}
	var req rpcRequest
	if e := readInput(w, r, &req); e != nil {
		rpcError(w, nil, -32700, "Invalid JSON-RPC request")
		return
	}
	if req.JSONRPC != "2.0" || req.Method == "" || (len(req.ID) > 0 && !validID(req.ID)) {
		rpcError(w, nil, -32600, "Invalid JSON-RPC envelope")
		return
	}
	if len(req.ID) == 0 {
		if req.Method == "notifications/initialized" || req.Method == "notifications/cancelled" {
			w.WriteHeader(202)
		} else {
			failure(w, problem("invalid_notification", 400))
		}
		return
	}
	switch req.Method {
	case "initialize":
		var in struct {
			ProtocolVersion string          `json:"protocolVersion"`
			Capabilities    json.RawMessage `json:"capabilities"`
			ClientInfo      json.RawMessage `json:"clientInfo"`
			Meta            json.RawMessage `json:"_meta,omitempty"`
		}
		if StrictDecode(req.Params, &in) != nil || in.ProtocolVersion == "" {
			rpcError(w, req.ID, -32602, "Invalid initialize parameters")
			return
		}
		version := ProtocolVersion
		if in.ProtocolVersion == "2025-06-18" || in.ProtocolVersion == "2025-03-26" {
			version = in.ProtocolVersion
		}
		rpcResult(w, req.ID, map[string]any{"protocolVersion": version, "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]any{"name": "auro-fish", "version": "1.0.0"}, "instructions": "Read fish@1 catalog, create a distinctive draft, validate, save, ensure an ocean, release the exact revision and hash, and open oceanUrl. Fish are persistent; swimming is ambient client presentation."})
	case "ping":
		rpcResult(w, req.ID, map[string]any{})
	case "tools/list":
		policy, e := h.mcpPolicy(r.Context())
		if e != nil {
			rpcError(w, req.ID, -32603, "MCP policy is unavailable")
			return
		}
		tools := []Tool{}
		for _, tool := range Tools() {
			if policy.Allows(tool.Name) {
				tools = append(tools, tool)
			}
		}
		rpcResult(w, req.ID, map[string]any{"tools": tools})
	case "tools/call":
		h.callTool(w, r, req)
	default:
		rpcError(w, req.ID, -32601, "Unknown method")
	}
}
func (h *HTTP) callTool(w http.ResponseWriter, r *http.Request, req rpcRequest) {
	var in struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
		Meta      json.RawMessage `json:"_meta,omitempty"`
	}
	if StrictDecode(req.Params, &in) != nil {
		rpcError(w, req.ID, -32602, "Invalid tool call")
		return
	}
	known := false
	for _, tool := range Tools() {
		if tool.Name == in.Name {
			known = true
		}
	}
	if !known {
		rpcError(w, req.ID, -32602, "Unknown tool")
		return
	}
	args := in.Arguments
	if len(args) == 0 {
		args = json.RawMessage(`{}`)
	}
	a, _ := actorFromContext(r.Context())
	ctx := r.Context()
	started := time.Now()
	call := mcpadmin.Call{ServiceID: MCPServiceID, WorkspaceID: a.WorkspaceID, ActorID: a.UserID, ToolName: in.Name, Outcome: "success"}
	defer func() {
		if h.Control == nil {
			return
		}
		call.DurationMS = time.Since(started).Milliseconds()
		logCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer cancel()
		if e := h.Control.RecordCall(logCtx, call); e != nil {
			slog.Error("MCP call activity could not be stored", "service", MCPServiceID, "error", e)
		}
	}()
	policy, policyErr := h.mcpPolicy(ctx)
	if policyErr != nil || !policy.Allows(in.Name) {
		code := "mcp_tool_disabled"
		call.Outcome = "blocked"
		if policyErr != nil {
			code = "mcp_policy_unavailable"
			call.Outcome = "error"
		} else if !policy.Enabled {
			code = "mcp_service_disabled"
		}
		call.ErrorCode = code
		toolFailure(w, req.ID, problem(code, 503))
		return
	}
	var result any
	var err error
	decode := func(out any) bool {
		if e := StrictDecode(args, out); e != nil {
			err = problem("invalid_request", 400)
			return false
		}
		return true
	}
	switch in.Name {
	case "fish_get_catalog":
		var empty struct{}
		if decode(&empty) {
			result = json.RawMessage(catalogJSON)
		}
	case "fish_validate":
		var p struct {
			Draft Draft `json:"draft"`
		}
		if decode(&p) {
			result = Validate(p.Draft)
		}
	case "fish_save":
		var p SaveInput
		if decode(&p) {
			p.Origin = "mcp"
			result, err = h.Service.Save(ctx, a, p)
		}
	case "fish_list":
		var p struct{}
		if decode(&p) {
			var items []Character
			items, err = h.Service.List(ctx, a)
			result = map[string]any{"fish": items}
		}
	case "fish_get":
		var p struct {
			FishID   string `json:"fishId"`
			Revision int    `json:"revision,omitempty"`
		}
		if decode(&p) {
			result, err = h.Service.Get(ctx, a, p.FishID, p.Revision)
		}
	case "fish_get_ocean":
		var p struct {
			OceanID string `json:"oceanId,omitempty"`
		}
		if decode(&p) {
			var ocean Ocean
			ocean, err = h.Service.Ocean(ctx, a, p.OceanID)
			var value any = ocean
			if ocean.ID == "" {
				value = nil
			}
			result = map[string]any{"ocean": value}
		}
	case "fish_create_ocean":
		var p struct {
			RequestID string `json:"requestId"`
		}
		if decode(&p) {
			result, err = h.Service.EnsureOcean(ctx, a, p.RequestID)
		}
	case "fish_release":
		var p ReleaseInput
		if decode(&p) {
			result, err = h.Service.Release(ctx, a, p)
		}
	case "fish_apply_revision":
		var p ApplyInput
		if decode(&p) {
			result, err = h.Service.Apply(ctx, a, p)
		}
	case "fish_recall":
		var p RecallInput
		if decode(&p) {
			result, err = h.Service.Recall(ctx, a, p)
		}
	}

	if err != nil {
		call.Outcome = "error"
		call.ErrorCode = asProblem(err).Code
		toolFailure(w, req.ID, err)
		return
	}
	payload, e := json.Marshal(result)
	if e != nil {
		call.Outcome = "error"
		call.ErrorCode = "result_encoding_failed"
		rpcError(w, req.ID, -32603, "Could not encode tool result")
		return
	}
	rpcResult(w, req.ID, map[string]any{"content": []any{map[string]any{"type": "text", "text": string(payload)}}, "structuredContent": result, "isError": false})
}

func (h *HTTP) mcpPolicy(ctx context.Context) (mcpadmin.Policy, error) {
	if h.Control == nil {
		return mcpadmin.Policy{}, problem("mcp_policy_unavailable", 503)
	}
	return h.Control.Policy(ctx, MCPServiceID)
}
func toolFailure(w http.ResponseWriter, id json.RawMessage, err error) {
	payload, _ := json.Marshal(map[string]any{"error": asProblem(err)})
	rpcResult(w, id, map[string]any{"isError": true, "content": []any{map[string]any{"type": "text", "text": string(payload)}}})
}
