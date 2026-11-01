CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_draft_restore_task_id ON chat_draft_restore USING btree (task_id);
