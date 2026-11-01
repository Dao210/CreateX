CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS game_policy_audit_identity_idx ON game_policy_audit (game_id, revision DESC);
