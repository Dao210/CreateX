CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS life_agent_id_idx ON life_agent USING btree (world_id, id);
