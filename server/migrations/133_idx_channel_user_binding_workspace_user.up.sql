CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_user_binding_workspace_user ON channel_user_binding USING btree (workspace_id, channel_user_id);
