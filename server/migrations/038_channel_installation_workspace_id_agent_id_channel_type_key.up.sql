CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS channel_installation_workspace_id_agent_id_channel_type_key ON channel_installation (workspace_id, agent_id, channel_type);
