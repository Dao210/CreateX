CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_mcp_server_workspace_name ON workspace_mcp_server USING btree (workspace_id, name);
