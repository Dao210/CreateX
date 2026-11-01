CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attachment_chat_message ON attachment USING btree (chat_message_id) WHERE (chat_message_id IS NOT NULL);
