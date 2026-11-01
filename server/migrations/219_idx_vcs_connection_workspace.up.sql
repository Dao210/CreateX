CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vcs_connection_workspace ON vcs_connection USING btree (workspace_id);
