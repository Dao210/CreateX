CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runtime_offline_last_seen ON agent_runtime USING btree (last_seen_at, id) WHERE (status = 'offline'::text);
