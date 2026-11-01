CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_usage_created_at ON task_usage USING btree (created_at);
