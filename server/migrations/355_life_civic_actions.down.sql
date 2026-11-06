-- Refuse a destructive downgrade once civilization history exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM life_action WHERE (intent ->> 'kind') IN (
    'DELIVER_WOOD', 'BUILD', 'STORE_FOOD', 'WITHDRAW_FOOD', 'MAINTAIN'
  )) THEN
    RAISE EXCEPTION 'Civilization actions exist; retain the forward schema or restore a matching database backup';
  END IF;
END $$;
ALTER TABLE life_action DROP CONSTRAINT IF EXISTS life_action_intent_check;
ALTER TABLE life_action ADD CONSTRAINT life_action_intent_check CHECK (
  (intent ->> 'kind') IN ('MOVE', 'REST', 'EAT', 'GATHER_WOOD', 'WORK', 'TALK')
);
