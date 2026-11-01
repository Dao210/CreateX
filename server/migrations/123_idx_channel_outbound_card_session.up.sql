CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_outbound_card_session ON channel_outbound_card_message USING btree (chat_session_id, created_at DESC);
