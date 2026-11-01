CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_media_pending_object_claim ON channel_media_pending_object USING btree (state, next_attempt_at);
