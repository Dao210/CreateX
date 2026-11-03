-- Keep administrators' world selections when restoring the earlier constraint.
ALTER TABLE game_policy DROP CONSTRAINT IF EXISTS game_policy_scope_check;
ALTER TABLE game_policy ADD CONSTRAINT game_policy_scope_check CHECK (scope IN ('all', 'selected', 'bound', 'disabled'));
