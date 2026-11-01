CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_installation_agent ON channel_installation USING btree (agent_id);
