ALTER TABLE IF EXISTS world_inbox_event DROP CONSTRAINT IF EXISTS world_inbox_event_kind_check;
ALTER TABLE IF EXISTS world_inbox_event ADD CONSTRAINT world_inbox_event_kind_check CHECK (kind IN ('tank_created', 'tank_updated', 'tank_level_up', 'resident_goal_reached'));
