CREATE UNIQUE INDEX CONCURRENTLY world_ops_followup_entry_id ON world_ops_followup_entry (workspace_id, followup_id, version);
