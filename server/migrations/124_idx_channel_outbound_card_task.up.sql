CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_outbound_card_task ON channel_outbound_card_message USING btree (task_id) WHERE (task_id IS NOT NULL);
