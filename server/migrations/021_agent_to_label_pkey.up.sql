CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agent_to_label_pkey ON agent_to_label (agent_id, label_id);
