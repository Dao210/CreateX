CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_inbound_audit_installation ON lark_inbound_audit USING btree (installation_id, received_at DESC);
