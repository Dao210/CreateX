CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agent_invocation_target_agent_id_target_type_target_id_key ON agent_invocation_target (agent_id, target_type, target_id);
