CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_autopilot_run_status ON autopilot_run USING btree (autopilot_id, status) WHERE (status = 'running'::text);
