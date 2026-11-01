CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_task_token_hash ON task_token USING btree (token_hash);
