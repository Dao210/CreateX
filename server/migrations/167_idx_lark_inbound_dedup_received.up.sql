CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_inbound_dedup_received ON lark_inbound_message_dedup USING btree (received_at);
