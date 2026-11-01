CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_github_installation_installation_id ON github_installation USING btree (installation_id);
