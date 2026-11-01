CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_usage_updated_at ON task_usage USING btree (updated_at);
