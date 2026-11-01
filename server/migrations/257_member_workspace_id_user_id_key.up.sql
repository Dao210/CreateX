CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS member_workspace_id_user_id_key ON member (workspace_id, user_id);
