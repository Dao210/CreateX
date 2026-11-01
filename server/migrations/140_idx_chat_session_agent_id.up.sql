CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_session_agent_id ON chat_session USING btree (agent_id);
