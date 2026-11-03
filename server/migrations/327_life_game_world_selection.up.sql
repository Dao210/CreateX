-- Preserve the effective audience of explicitly saved bound-only policies.
UPDATE game_world_override o
SET access = 'deny'
FROM game_policy p
WHERE p.game_id = 'life' AND p.scope = 'bound' AND o.game_id = p.game_id
  AND NOT EXISTS (SELECT 1 FROM life_world l WHERE l.workspace_id = o.workspace_id);

INSERT INTO game_world_override (game_id, workspace_id, access, visibility)
SELECT p.game_id, l.workspace_id, 'allow', 'inherit'
FROM game_policy p
JOIN life_world l ON true
JOIN workspace w ON w.id = l.workspace_id
WHERE p.game_id = 'life' AND p.scope = 'bound'
ON CONFLICT (game_id, workspace_id) DO UPDATE
SET access = CASE WHEN game_world_override.access = 'inherit' THEN 'allow' ELSE game_world_override.access END;

UPDATE game_policy SET scope = 'selected' WHERE game_id = 'life' AND scope = 'bound';

ALTER TABLE game_policy DROP CONSTRAINT IF EXISTS game_policy_scope_check;
ALTER TABLE game_policy ADD CONSTRAINT game_policy_scope_check CHECK (scope IN ('all', 'selected', 'disabled'));
