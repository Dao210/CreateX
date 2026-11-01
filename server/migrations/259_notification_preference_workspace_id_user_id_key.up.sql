CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS notification_preference_workspace_id_user_id_key ON notification_preference (workspace_id, user_id);
