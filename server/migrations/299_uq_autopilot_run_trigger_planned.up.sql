CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_autopilot_run_trigger_planned ON autopilot_run USING btree (trigger_id, planned_at) WHERE ((trigger_id IS NOT NULL) AND (planned_at IS NOT NULL));
