CREATE INDEX CONCURRENTLY world_inbox_event_summary ON world_inbox_event (workspace_id, occurred_at, id) WHERE summarized_at IS NULL;
