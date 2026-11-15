ALTER TABLE IF EXISTS game_policy DROP CONSTRAINT IF EXISTS game_policy_game_id_check;
ALTER TABLE IF EXISTS game_policy ADD CONSTRAINT game_policy_game_id_check CHECK (game_id IN ('siege','tanks','life','fish','ctf'));
ALTER TABLE IF EXISTS game_world_override DROP CONSTRAINT IF EXISTS game_world_override_game_id_check;
ALTER TABLE IF EXISTS game_world_override ADD CONSTRAINT game_world_override_game_id_check CHECK (game_id IN ('siege','tanks','life','fish','ctf'));
