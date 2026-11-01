CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_autopilot_trigger_next_run ON autopilot_trigger USING btree (next_run_at) WHERE ((enabled = true) AND (kind = 'schedule'::text));
