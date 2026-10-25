package cli

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// ServeTankMCP is a stdio transport for the same authenticated HTTP MCP server.
// Credentials stay in the existing CLI profile or daemon-injected task env.
func (c *APIClient) ServeTankMCP(ctx context.Context, input io.Reader, output io.Writer) error {
	if c.Token == "" {
		return fmt.Errorf("sign in with auro login before starting tank MCP")
	}
	if c.WorkspaceID == "" {
		return fmt.Errorf("tank MCP requires --workspace-id or AURO_WORKSPACE_ID")
	}
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 64*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var envelope struct {
			ID json.RawMessage `json:"id"`
		}
		_ = json.Unmarshal(line, &envelope)
		req, e := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/tanks/mcp", bytes.NewReader(line))
		if e != nil {
			return fmt.Errorf("invalid tank MCP server URL")
		}
		c.setHeaders(req)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		req.Header.Set("MCP-Protocol-Version", "2025-11-25")
		resp, e := c.HTTPClient.Do(req)
		var response []byte
		if e == nil {
			response, e = io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
			_ = resp.Body.Close()
		}
		if e != nil || resp.StatusCode != 200 && resp.StatusCode != 202 {
			if len(envelope.ID) == 0 {
				continue
			}
			message := "Tank MCP service is unavailable."
			if resp != nil {
				message = fmt.Sprintf("Tank MCP HTTP %d; check the CLI login and workspace.", resp.StatusCode)
			}
			response, _ = json.Marshal(map[string]any{"jsonrpc": "2.0", "id": envelope.ID, "error": map[string]any{"code": -32000, "message": message}})
		}
		if len(bytes.TrimSpace(response)) > 0 {
			if !json.Valid(response) {
				return fmt.Errorf("tank MCP returned an invalid response")
			}
			var compact bytes.Buffer
			if e = json.Compact(&compact, response); e != nil {
				return e
			}
			if _, e = fmt.Fprintln(output, compact.String()); e != nil {
				return e
			}
		}
	}
	return scanner.Err()
}
