CREATE INDEX CONCURRENTLY IF NOT EXISTS tank_character_workspace ON tank_character USING btree (workspace_id, updated_at DESC);
