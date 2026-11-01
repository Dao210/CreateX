CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_workspace ON member USING btree (workspace_id);
