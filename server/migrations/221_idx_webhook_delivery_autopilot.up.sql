CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_delivery_autopilot ON webhook_delivery USING btree (autopilot_id, created_at DESC);
