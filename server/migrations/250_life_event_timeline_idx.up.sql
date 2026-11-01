CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS life_event_timeline_idx ON life_event USING btree (world_id, tick DESC, id);
