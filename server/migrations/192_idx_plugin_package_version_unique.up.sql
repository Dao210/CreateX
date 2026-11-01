CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_package_version_unique ON plugin_package_version USING btree (package_id, version);
