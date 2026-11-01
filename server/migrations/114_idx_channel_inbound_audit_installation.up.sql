CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_inbound_audit_installation ON channel_inbound_audit USING btree (installation_id, received_at DESC);
