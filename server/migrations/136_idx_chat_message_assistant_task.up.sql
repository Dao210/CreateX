CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_message_assistant_task ON chat_message USING btree (task_id, created_at DESC) WHERE (role = 'assistant'::text);
