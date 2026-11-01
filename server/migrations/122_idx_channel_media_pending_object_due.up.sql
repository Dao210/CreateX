CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_media_pending_object_due ON channel_media_pending_object USING btree (next_attempt_at);
