CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_task_delivery_installation ON channel_task_delivery USING btree (installation_id);
