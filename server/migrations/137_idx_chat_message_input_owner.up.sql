CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_message_input_owner ON chat_message USING btree (task_id, created_at) WHERE (role = 'user'::text);
