CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_token_agent_id ON task_token USING btree (agent_id);
