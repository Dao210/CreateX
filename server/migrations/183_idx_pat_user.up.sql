CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pat_user ON personal_access_token USING btree (user_id, revoked);
