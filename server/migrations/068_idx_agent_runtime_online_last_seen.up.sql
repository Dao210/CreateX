CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runtime_online_last_seen ON agent_runtime USING btree (last_seen_at) WHERE (status = 'online'::text);
