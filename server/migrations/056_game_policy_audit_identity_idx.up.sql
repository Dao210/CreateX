CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS game_policy_audit_identity_idx ON game_policy_audit USING btree (game_id, revision DESC);
