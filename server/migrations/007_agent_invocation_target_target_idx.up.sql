CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_invocation_target_target_idx ON agent_invocation_target USING btree (target_type, target_id);
