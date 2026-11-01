CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_usage_task_id ON task_usage USING btree (task_id);
