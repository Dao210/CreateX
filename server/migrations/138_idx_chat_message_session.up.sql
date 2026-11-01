CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_message_session ON chat_message USING btree (chat_session_id, created_at);
