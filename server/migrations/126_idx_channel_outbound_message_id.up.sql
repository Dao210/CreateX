CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_outbound_message_id ON channel_outbound_message USING btree (installation_id, channel_message_id);
