CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_github_installation_workspace ON github_installation USING btree (workspace_id);
