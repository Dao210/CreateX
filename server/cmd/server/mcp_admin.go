package main

import (
	"github.com/auro-ai/auro/server/internal/mcpadmin"
	"github.com/auro-ai/auro/server/internal/tanks"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newMCPAdminService(pool *pgxpool.Pool, emails string) (*mcpadmin.Service, error) {
	tools := make([]mcpadmin.Tool, 0, len(tanks.Tools()))
	for _, tool := range tanks.Tools() {
		read, _ := tool.Annotations["readOnlyHint"].(bool)
		tools = append(tools, mcpadmin.Tool{Name: tool.Name, Description: tool.Description, InputSchema: tool.InputSchema, ReadOnly: read})
	}
	return mcpadmin.New(pool, emails, []mcpadmin.Definition{{ID: tanks.MCPServiceID, Name: "Tank Defense", Endpoint: "/api/tanks/mcp", ProtocolVersion: tanks.ProtocolVersion, Tools: tools}})
}
