CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_daemon_token_hash ON daemon_token USING btree (token_hash);
