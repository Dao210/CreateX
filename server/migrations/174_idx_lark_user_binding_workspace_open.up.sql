CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_user_binding_workspace_open ON lark_user_binding USING btree (workspace_id, lark_open_id);
