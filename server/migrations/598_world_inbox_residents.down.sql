DELETE FROM world_inbox_event WHERE kind = 'resident_goal_reached';
ALTER TABLE world_inbox_event ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE world_inbox_event DROP CONSTRAINT IF EXISTS world_inbox_event_kind_check;
ALTER TABLE world_inbox_event ADD CONSTRAINT world_inbox_event_kind_check
    CHECK (kind IN ('tank_created', 'tank_updated', 'tank_level_up'));
