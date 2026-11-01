CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_package_workspace_key ON plugin_package USING btree (workspace_id, plugin_key);
