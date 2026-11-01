CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_installation_package_version ON plugin_installation USING btree (package_version_id);
