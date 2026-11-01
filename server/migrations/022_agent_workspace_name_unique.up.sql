CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agent_workspace_name_unique ON agent (workspace_id, name);
