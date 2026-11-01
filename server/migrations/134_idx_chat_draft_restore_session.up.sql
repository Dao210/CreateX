CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_draft_restore_session ON chat_draft_restore USING btree (chat_session_id);
