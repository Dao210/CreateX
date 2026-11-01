CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_session_creator ON chat_session USING btree (creator_id, workspace_id);
