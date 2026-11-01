CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_installation_workspace ON channel_installation USING btree (workspace_id);
