CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_package_version_package ON plugin_package_version USING btree (package_id, created_at DESC);
