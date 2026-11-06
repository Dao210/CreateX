CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS world_ops_followup_open ON world_ops_followup (workspace_id) WHERE closed_at IS NULL;
