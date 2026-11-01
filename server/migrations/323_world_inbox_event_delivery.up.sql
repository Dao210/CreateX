CREATE INDEX CONCURRENTLY IF NOT EXISTS world_inbox_event_delivery ON world_inbox_event USING btree (occurred_at, id) WHERE (delivered_at IS NULL);
