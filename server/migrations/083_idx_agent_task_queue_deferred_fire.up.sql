CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_task_queue_deferred_fire ON agent_task_queue USING btree (runtime_id, fire_at) WHERE (status = 'deferred'::text);
