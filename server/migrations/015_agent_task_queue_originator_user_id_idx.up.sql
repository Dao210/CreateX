CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_task_queue_originator_user_id_idx ON agent_task_queue USING btree (originator_user_id) WHERE (originator_user_id IS NOT NULL);
