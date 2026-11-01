CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_inbound_audit_reason ON channel_inbound_audit USING btree (drop_reason, received_at DESC);
