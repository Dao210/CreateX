CREATE INDEX CONCURRENTLY world_inbox_event_delivery ON world_inbox_event (occurred_at, id) WHERE delivered_at IS NULL;
