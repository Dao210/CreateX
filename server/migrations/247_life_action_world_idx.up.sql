CREATE INDEX CONCURRENTLY IF NOT EXISTS life_action_world_idx ON life_action USING btree (world_id, status, due_tick);
