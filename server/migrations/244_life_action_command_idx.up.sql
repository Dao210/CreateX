CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS life_action_command_idx ON life_action USING btree (world_id, agent_id, started_tick);
