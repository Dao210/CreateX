CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_delivery_run ON webhook_delivery USING btree (autopilot_run_id) WHERE (autopilot_run_id IS NOT NULL);
