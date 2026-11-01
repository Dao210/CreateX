CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS life_event_action_idx ON life_event USING btree (action_id) WHERE (action_id IS NOT NULL);
