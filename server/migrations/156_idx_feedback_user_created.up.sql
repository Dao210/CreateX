CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feedback_user_created ON feedback USING btree (user_id, created_at DESC);
