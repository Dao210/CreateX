CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_usage_hourly_dirty_enqueued_at ON task_usage_hourly_dirty USING btree (enqueued_at);
