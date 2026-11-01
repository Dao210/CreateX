CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_hook_schedule_enabled ON plugin_hook_schedule USING btree (id) WHERE enabled;
