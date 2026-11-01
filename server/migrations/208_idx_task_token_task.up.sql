CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_token_task ON task_token USING btree (task_id);
