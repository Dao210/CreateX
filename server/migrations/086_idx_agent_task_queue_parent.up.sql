CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_task_queue_parent ON agent_task_queue USING btree (parent_task_id);
