CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_package_file_path ON plugin_package_file USING btree (version_id, path);
