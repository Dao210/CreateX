CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_installation_workspace ON lark_installation USING btree (workspace_id);
