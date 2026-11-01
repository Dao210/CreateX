CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attachment_workspace ON attachment USING btree (workspace_id);
