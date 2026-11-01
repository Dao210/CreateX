CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_delivery_queue ON webhook_delivery USING btree (available_at, created_at) WHERE (status = 'queued'::text);
