CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mcp_activity_service_time ON mcp_activity (service_id, occurred_at DESC, id DESC);
