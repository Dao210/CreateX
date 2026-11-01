CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_task_queue_running_started_at ON agent_task_queue USING btree (started_at) WHERE (status = 'running'::text);
