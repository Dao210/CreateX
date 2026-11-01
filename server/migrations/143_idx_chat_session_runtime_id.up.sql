CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_session_runtime_id ON chat_session USING btree (runtime_id) WHERE (runtime_id IS NOT NULL);
