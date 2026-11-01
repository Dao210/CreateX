CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runtime_workspace_id_keyset ON agent_runtime USING btree (workspace_id, id);
