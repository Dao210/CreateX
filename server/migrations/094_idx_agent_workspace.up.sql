CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_workspace ON agent USING btree (workspace_id);
