CREATE INDEX CONCURRENTLY IF NOT EXISTS life_event_town_history ON life_event(world_id,tick DESC,id) WHERE kind IN ('town_command','town_activity','town_conversation','goal_reached');
