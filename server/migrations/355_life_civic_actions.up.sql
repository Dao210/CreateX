-- Existing actions and their identities are retained; widen the closed action contract.
ALTER TABLE life_action DROP CONSTRAINT IF EXISTS life_action_intent_check;
ALTER TABLE life_action ADD CONSTRAINT life_action_intent_check CHECK (
  (intent ->> 'kind') IN (
    'MOVE', 'REST', 'EAT', 'GATHER_WOOD', 'WORK', 'TALK',
    'DELIVER_WOOD', 'BUILD', 'STORE_FOOD', 'WITHDRAW_FOOD', 'MAINTAIN'
  )
);
