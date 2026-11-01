CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_skill_agent ON agent_skill USING btree (agent_id);
