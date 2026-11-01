CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS game_world_override_identity_idx ON game_world_override USING btree (game_id, workspace_id);
