CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_invocation_target_agent_id_idx ON agent_invocation_target USING btree (agent_id);
