CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attachment_task ON attachment USING btree (task_id) WHERE (task_id IS NOT NULL);
