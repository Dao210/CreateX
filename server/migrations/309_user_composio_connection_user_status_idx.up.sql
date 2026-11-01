CREATE INDEX CONCURRENTLY IF NOT EXISTS user_composio_connection_user_status_idx ON user_composio_connection USING btree (user_id, status);
