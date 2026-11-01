CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_verification_code_email ON verification_code USING btree (email, used, expires_at);
