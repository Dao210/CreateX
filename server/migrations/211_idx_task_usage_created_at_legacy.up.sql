CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_usage_created_at_legacy ON task_usage USING btree (created_at) WHERE (updated_at IS NULL);
