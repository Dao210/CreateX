CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_task_queue_claim_candidates ON agent_task_queue USING btree (runtime_id, priority DESC, created_at) WHERE (status = 'queued'::text);
