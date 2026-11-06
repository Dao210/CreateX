CREATE INDEX CONCURRENTLY IF NOT EXISTS world_ops_action_time ON world_ops_action (workspace_id, occurred_at DESC);
