CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_autopilot_run_task_id ON autopilot_run USING btree (task_id);
