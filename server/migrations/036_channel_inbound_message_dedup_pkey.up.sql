CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS channel_inbound_message_dedup_pkey ON channel_inbound_message_dedup (installation_id, message_id);
