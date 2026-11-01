CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS lark_inbound_message_dedup_pkey ON lark_inbound_message_dedup (installation_id, message_id);
