CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_pinned_agent_user_ws ON chat_pinned_agent USING btree (workspace_id, user_id, "position");
