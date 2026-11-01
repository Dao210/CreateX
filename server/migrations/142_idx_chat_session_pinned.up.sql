CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_session_pinned ON chat_session USING btree (creator_id, workspace_id, pinned_at DESC) WHERE (pinned_at IS NOT NULL);
