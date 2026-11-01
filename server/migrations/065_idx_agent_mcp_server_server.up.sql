CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_mcp_server_server ON agent_mcp_server USING btree (server_id);
