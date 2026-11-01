CREATE INDEX CONCURRENTLY IF NOT EXISTS user_composio_connection_account_idx ON user_composio_connection USING btree (connected_account_id);
