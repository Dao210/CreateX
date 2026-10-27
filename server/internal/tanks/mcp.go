package tanks

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
const MCPServiceID = "auro-tanks"

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Annotations map[string]any `json:"annotations"`
}

func object(properties map[string]any, required ...string) map[string]any {
	return map[string]any{"type": "object", "properties": properties, "required": append([]string{}, required...), "additionalProperties": false}
}
func Tools() []Tool {
	stringField := map[string]any{"type": "string"}
	id := map[string]any{"type": "string", "format": "uuid"}
	revision := map[string]any{"type": "integer", "minimum": 1, "maximum": 50}
	ref := func(request bool) map[string]any {
		maps := make([]string, 0, len(Rules.Maps))
		for _, m := range Rules.Maps {
			maps = append(maps, m.ID)
		}
		p := map[string]any{"characterId": id, "revision": revision, "contentHash": map[string]any{"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"}, "mapId": map[string]any{"type": "string", "enum": maps}, "mode": map[string]any{"type": "string", "enum": Rules.Modes, "default": "campaign"}}
		required := []string{"characterId", "revision", "contentHash", "mapId"}
		if request {
			p["requestId"] = id
			required = append(required, "requestId")
		}
		return object(p, required...)
	}
	definitions := []struct {
		name, description string
		schema            map[string]any
		read              bool
	}{
		{"tank_get_catalog", "Read the classic tank character schema, parts, 9-point budget, deterministic stats, and map versions. The calling agent creates the draft; no server model or arbitrary scripts/assets are used.", object(map[string]any{}), true},
		{"tank_validate_character", "Validate an agent-created tank draft and preview compiled combat stats. Invalid parts are reported, never replaced with a preset.", object(map[string]any{"draft": json.RawMessage(Rules.DraftSchema)}, "draft"), true},
		{"tank_save_character", "Save a tank into this workspace's character library. Use a fresh UUID requestId per intended write and reuse it unchanged on retry. Updating an owned character also requires characterId and expectedRevision.", object(map[string]any{"requestId": id, "draft": json.RawMessage(Rules.DraftSchema), "characterId": id, "expectedRevision": revision}, "requestId", "draft"), false},
		{"tank_list_characters", "List saved characters in the authenticated workspace, including immutable version references and hashes.", object(map[string]any{}), true},
		{"tank_get_character", "Read a saved character. Omit revision for latest, or supply a revision to read an immutable version.", object(map[string]any{"characterId": id, "revision": revision}, "characterId"), true},
		{"tank_check_compatibility", "Check an exact character revision/hash against a map before creating a play session.", ref(false), true},
		{"tank_create_session", "Freeze the character and starting map into a 24-hour play session. Returns playUrl: open it in Auro and let the user drive with keyboard/touch. Requires the same Auro account; do not transmit movement through MCP. Reuse requestId unchanged on retry.", ref(true), false},
		{"tank_get_session", "Read a frozen play session created by this authenticated user. It is not a live physics snapshot or a verified battle result.", object(map[string]any{"sessionId": stringField}, "sessionId"), true},
	}
	out := make([]Tool, 0, len(definitions))
	for _, d := range definitions {
		out = append(out, Tool{Name: d.name, Description: d.description, InputSchema: d.schema, Annotations: map[string]any{"readOnlyHint": d.read, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}})
	}
	return out
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
		rpcResult(w, req.ID, map[string]any{"protocolVersion": version, "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]any{"name": "auro-tanks", "version": "1.0.0"}, "instructions": "Create tank-defense@1 drafts from the catalog, validate, save, check compatibility, then create a frozen session and open its playUrl. All tools are bound to the authenticated workspace."})
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
	case "tank_get_catalog":
		var empty struct{}
		if decode(&empty) {
			result = json.RawMessage(catalogJSON)
		}
	case "tank_validate_character":
		var p struct {
			Draft Draft `json:"draft"`
		}
		if decode(&p) {
			result = Validate(p.Draft, "custom")
		}
	case "tank_save_character":
		var p SaveInput
		if decode(&p) {
			p.Origin = OriginMCP
			result, err = h.Service.Save(ctx, a, p)
		}
	case "tank_list_characters":
		var empty struct{}
		if decode(&empty) {
			var items []Character
			items, err = h.Service.List(ctx, a, false)
			result = map[string]any{"characters": items}
		}
	case "tank_get_character":
		var p struct {
			CharacterID string `json:"characterId"`
			Revision    int    `json:"revision,omitempty"`
		}
		if decode(&p) {
			result, err = h.Service.GetCharacter(ctx, a, p.CharacterID, p.Revision)
		}
	case "tank_check_compatibility":
		var p struct {
			CharacterID string `json:"characterId"`
			Revision    int    `json:"revision"`
			ContentHash string `json:"contentHash"`
			MapID       string `json:"mapId"`
			Mode        string `json:"mode,omitempty"`
		}
		if decode(&p) {
			var c Character
			var m Map
			c, m, err = h.Service.Compatibility(ctx, a, SessionInput{CharacterID: p.CharacterID, Revision: p.Revision, ContentHash: p.ContentHash, MapID: p.MapID, Mode: p.Mode})
			result = map[string]any{"compatible": true, "characterId": c.ID, "revision": c.Revision, "contentHash": c.ContentHash, "map": m}
		}
	case "tank_create_session":
		var p SessionInput
		if decode(&p) {
			result, err = h.Service.CreateSession(ctx, a, p)
		}
	case "tank_get_session":
		var p struct {
			SessionID string `json:"sessionId"`
		}
		if decode(&p) {
			result, err = h.Service.GetSession(ctx, a, p.SessionID)
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
