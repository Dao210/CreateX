CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mcp_activity_workspace ON mcp_activity USING btree (workspace_id);
