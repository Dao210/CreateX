-- Life is one shared simulation. This column records its original source, not access ownership.
ALTER TABLE life_world ALTER COLUMN workspace_id DROP NOT NULL;
UPDATE game_policy SET scope='all',revision=revision+1,updated_at=clock_timestamp()
WHERE game_id='life' AND scope<>'all';
DELETE FROM game_world_override WHERE game_id='life' AND visibility='inherit';
UPDATE game_world_override SET access='inherit' WHERE game_id='life' AND access<>'inherit';
