CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_binding_token_installation ON lark_binding_token USING btree (installation_id, expires_at);
