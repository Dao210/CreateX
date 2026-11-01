CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daemon_token_workspace_daemon ON daemon_token USING btree (workspace_id, daemon_id);
