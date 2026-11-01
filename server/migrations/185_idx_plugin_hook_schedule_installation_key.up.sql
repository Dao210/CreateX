CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_hook_schedule_installation_key ON plugin_hook_schedule USING btree (installation_id, hook_key);
