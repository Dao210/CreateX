CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_installation_lease ON channel_installation USING btree (ws_lease_expires_at) WHERE (status = 'active'::text);
