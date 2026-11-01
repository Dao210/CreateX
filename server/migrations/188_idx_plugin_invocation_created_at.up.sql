CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_invocation_created_at ON plugin_invocation USING btree (created_at);
