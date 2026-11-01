CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_inbound_audit_reason ON lark_inbound_audit USING btree (drop_reason, received_at DESC);
