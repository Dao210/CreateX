CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_binding_token_installation ON channel_binding_token USING btree (installation_id, expires_at);
