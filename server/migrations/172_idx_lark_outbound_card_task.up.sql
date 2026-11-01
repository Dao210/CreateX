CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_outbound_card_task ON lark_outbound_card_message USING btree (task_id) WHERE (task_id IS NOT NULL);
