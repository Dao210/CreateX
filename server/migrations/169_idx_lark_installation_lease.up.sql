CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lark_installation_lease ON lark_installation USING btree (ws_lease_expires_at) WHERE (status = 'active'::text);
