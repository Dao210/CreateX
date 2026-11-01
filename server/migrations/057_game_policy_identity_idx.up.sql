CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS game_policy_identity_idx ON game_policy USING btree (game_id);
