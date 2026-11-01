CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_task_queue_agent_id_keyset ON agent_task_queue USING btree (agent_id, id);
