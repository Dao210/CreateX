CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS life_action_running_idx ON life_action (world_id, agent_id) WHERE status = 'running';
