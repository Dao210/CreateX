CREATE INDEX CONCURRENTLY IF NOT EXISTS world_inbox_event_summary ON world_inbox_event USING btree (workspace_id, occurred_at, id) WHERE (summarized_at IS NULL);
