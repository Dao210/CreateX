CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_task_queue_autopilot_run_created_at ON agent_task_queue USING btree (autopilot_run_id, created_at) WHERE (autopilot_run_id IS NOT NULL);
