CREATE INDEX CONCURRENTLY IF NOT EXISTS life_event_town_sequence ON life_event(world_id,sequence DESC) WHERE kind IN ('town_command','town_activity','town_conversation','goal_reached');
