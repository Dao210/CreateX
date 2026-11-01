CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_created_at ON "user" USING btree (created_at);
