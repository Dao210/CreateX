CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attachment_chat_session ON attachment USING btree (chat_session_id) WHERE (chat_session_id IS NOT NULL);
