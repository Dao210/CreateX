CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_session_workspace ON chat_session USING btree (workspace_id);
