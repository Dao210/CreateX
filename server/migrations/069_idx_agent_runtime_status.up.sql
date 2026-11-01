CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runtime_status ON agent_runtime USING btree (workspace_id, status);
