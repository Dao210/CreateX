CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_task_delivery_binding ON channel_task_delivery USING btree (binding_id);
