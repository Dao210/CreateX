CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_installation_workspace_key ON plugin_installation USING btree (workspace_id, plugin_key);
