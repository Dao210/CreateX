CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_task_queue_runtime_id ON agent_task_queue USING btree (runtime_id, id);
