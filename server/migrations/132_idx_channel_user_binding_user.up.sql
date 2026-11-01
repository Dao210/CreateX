CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_user_binding_user ON channel_user_binding USING btree (auro_user_id, workspace_id);
