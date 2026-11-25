-- name: LockFishExplorationWorkspaces :many
SELECT w.id FROM workspace w WHERE EXISTS (
 SELECT 1 FROM fish_publication p WHERE p.workspace_id=w.id AND p.active
) ORDER BY w.id FOR KEY SHARE OF w;

-- name: ListFishExplorers :many
SELECT p.id,p.workspace_id,p.user_id,p.payload,COALESCE(e.state,'null'::jsonb) AS exploration
FROM fish_publication p LEFT JOIN fish_exploration_state e ON e.resident_id=p.id
WHERE p.active AND p.workspace_id=ANY(sqlc.arg(workspace_ids)::uuid[])
ORDER BY p.id FOR SHARE OF p;

-- name: GetFishExplorationClock :one
SELECT tick,last_tick FROM fish_exploration_clock WHERE id=1;

-- name: PutFishExplorationClock :exec
INSERT INTO fish_exploration_clock(id,tick,last_tick) VALUES(1,$1,$2)
ON CONFLICT(id) DO UPDATE SET tick=EXCLUDED.tick,last_tick=EXCLUDED.last_tick;

-- name: PutFishExplorationState :exec
INSERT INTO fish_exploration_state(resident_id,workspace_id,user_id,state) VALUES($1,$2,$3,$4)
ON CONFLICT(resident_id) DO UPDATE SET state=EXCLUDED.state;

-- name: DeleteFishExplorationState :exec
DELETE FROM fish_exploration_state WHERE resident_id=$1;

-- name: PruneFishExplorationStates :exec
DELETE FROM fish_exploration_state e WHERE NOT EXISTS (
 SELECT 1 FROM fish_publication p WHERE p.id=e.resident_id AND p.active
);

-- name: HasWorldInboxEvent :one
SELECT EXISTS(SELECT 1 FROM world_inbox_event WHERE id=$1);
