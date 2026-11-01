CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_autopilot_rule_version_active ON autopilot_rule_version USING btree (workspace_id, autopilot_id, created_at DESC);
