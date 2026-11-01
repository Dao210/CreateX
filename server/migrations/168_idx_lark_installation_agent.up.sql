CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_installation_agent ON lark_installation USING btree (agent_id);
