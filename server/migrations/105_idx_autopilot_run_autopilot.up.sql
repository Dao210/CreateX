CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_autopilot_run_autopilot ON autopilot_run USING btree (autopilot_id, created_at DESC);
