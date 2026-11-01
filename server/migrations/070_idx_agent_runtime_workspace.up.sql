CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runtime_workspace ON agent_runtime USING btree (workspace_id);
