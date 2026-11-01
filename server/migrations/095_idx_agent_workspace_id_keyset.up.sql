CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_workspace_id_keyset ON agent USING btree (workspace_id, id);
