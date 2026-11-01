CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_daemon_agent ON daemon_connection (agent_id, daemon_id);
