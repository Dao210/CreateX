CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS world_ops_followup_entry_id ON world_ops_followup_entry (workspace_id, followup_id, version);
