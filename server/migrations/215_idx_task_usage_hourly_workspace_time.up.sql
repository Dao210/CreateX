CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_usage_hourly_workspace_time ON task_usage_hourly USING btree (workspace_id, bucket_hour DESC);
