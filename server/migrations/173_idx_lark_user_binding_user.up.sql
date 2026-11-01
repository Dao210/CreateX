CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_user_binding_user ON lark_user_binding USING btree (auro_user_id, workspace_id);
