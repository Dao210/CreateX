CREATE INDEX CONCURRENTLY IF NOT EXISTS client_usage_daily_workspace_idx ON client_usage_daily USING btree (workspace_id) WHERE (workspace_id IS NOT NULL);
