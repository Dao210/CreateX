-- name: GetLifeSnapshot :one
SELECT jsonb_build_object(
 'world', jsonb_build_object('id',w.id,'workspaceId',w.workspace_id,'tick',w.tick,'tickMs',w.tick_ms,'updatedAt',w.updated_at),
 'town', w.town,
 'eventCursor',COALESCE((SELECT max(sequence) FROM life_event WHERE world_id=w.id AND kind IN ('town_command','town_activity','town_conversation','goal_reached')),0),
 'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',a.id,'name',a.name,'position',jsonb_build_object('x',a.x,'y',a.y),
   'energy',a.energy,'fullness',a.fullness,'social',a.social,'personality',a.personality,'goal',a.goal
 ) ORDER BY a.id) FROM life_agent a WHERE a.world_id=w.id),'[]'::jsonb),
 'resources', COALESCE((SELECT jsonb_agg(jsonb_build_object('owner',r.owner,'kind',r.kind,'amount',r.amount) ORDER BY r.owner,r.kind)
   FROM life_resource r WHERE r.world_id=w.id),'[]'::jsonb),
 'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'agentId',c.agent_id,'intent',c.intent,'reason',c.reason,
   'startedTick',c.started_tick,'dueTick',c.due_tick,'status',c.status) ORDER BY c.agent_id)
   FROM life_action c WHERE c.world_id=w.id AND c.status='running'),'[]'::jsonb),
 'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'sequence',e.sequence,'tick',e.tick,'actionId',e.action_id,
   'agentId',e.agent_id,'kind',e.kind,'payload',e.payload,'occurredAt',e.occurred_at) ORDER BY e.tick DESC,e.id)
   FROM (SELECT * FROM life_event WHERE world_id=w.id ORDER BY tick DESC,id LIMIT 80) e),'[]'::jsonb)
)::jsonb AS snapshot
FROM life_world w WHERE w.workspace_id=$1;





-- name: LockLifeWorldForDeletion :exec
SELECT 1 FROM life_world WHERE workspace_id=$1 FOR UPDATE;





-- name: DeleteLifeWorldState :exec
WITH deleted_requests AS (
 DELETE FROM life_request WHERE world_id IN (SELECT life_world.id FROM life_world WHERE life_world.workspace_id=$1)
), deleted_events AS (
 DELETE FROM life_event WHERE world_id IN (SELECT life_world.id FROM life_world WHERE life_world.workspace_id=$1)
), deleted_actions AS (
 DELETE FROM life_action WHERE world_id IN (SELECT life_world.id FROM life_world WHERE life_world.workspace_id=$1)
), deleted_resources AS (
 DELETE FROM life_resource WHERE world_id IN (SELECT life_world.id FROM life_world WHERE life_world.workspace_id=$1)
), deleted_agents AS (
 DELETE FROM life_agent WHERE world_id IN (SELECT life_world.id FROM life_world WHERE life_world.workspace_id=$1)
)
DELETE FROM life_world WHERE life_world.workspace_id=$1;

-- name: GetLifeBinding :one
SELECT * FROM life_world;

-- name: LockLifeInitialization :exec
SELECT pg_advisory_xact_lock(173121, 1);

-- name: LockLifeWorkspace :one
SELECT id FROM workspace WHERE id=$1 FOR KEY SHARE;

-- name: LockLifeWorld :one
SELECT * FROM life_world WHERE id=$1 FOR UPDATE;

-- name: IsLifeTickDue :one
SELECT next_tick_at <= clock_timestamp() AS due FROM life_world WHERE id=$1;

-- name: CreateLifeWorld :exec
INSERT INTO life_world(id,workspace_id,tick_ms) VALUES($1,$2,$3);

-- name: CreateLifeResident :exec
INSERT INTO life_agent(world_id,id,name,x,y,energy,fullness,social,personality,goal)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);

-- name: CreateLifeResource :exec
INSERT INTO life_resource(world_id,owner,kind,amount) VALUES($1,$2,$3,$4);

-- name: SaveLifeResident :execrows
UPDATE life_agent SET x=$3,y=$4,energy=$5,fullness=$6,social=$7 WHERE world_id=$1 AND id=$2;

-- name: SaveLifeResource :execrows
UPDATE life_resource SET amount=$4 WHERE world_id=$1 AND owner=$2 AND kind=$3;

-- name: CompleteLifeAction :execrows
UPDATE life_action SET status=$3,completed_tick=$4 WHERE world_id=$1 AND id=$2 AND status='running';

-- name: StartLifeAction :exec
INSERT INTO life_action(world_id,id,agent_id,intent,reason,started_tick,due_tick,status)
VALUES($1,$2,$3,$4,$5,$6,$7,'running');

-- name: AppendLifeEvent :exec
INSERT INTO life_event(world_id,id,tick,action_id,agent_id,kind,payload) VALUES($1,$2,$3,$4,$5,$6,$7);

-- name: CommitLifeTick :exec
UPDATE life_world SET tick=$2,updated_at=clock_timestamp(),next_tick_at=clock_timestamp()+tick_ms*interval '1 millisecond' WHERE id=$1;

-- name: SaveLifeTown :execrows
UPDATE life_world SET town=$2 WHERE id=$1;

-- name: GetLifeRequest :one
SELECT body_hash,response FROM life_request WHERE world_id=$1 AND user_id=$2 AND request_id=$3;

-- name: SaveLifeRequest :exec
INSERT INTO life_request(world_id,user_id,request_id,body_hash,response) VALUES($1,$2,$3,$4,$5);

-- name: IsLifeMember :one
SELECT EXISTS(SELECT 1 FROM member WHERE workspace_id=$1 AND user_id=$2) AS member;

-- name: GetLifeHistory :one
SELECT jsonb_build_object(
 'workspaceId',w.workspace_id,'sinceSequence',sqlc.arg(since_sequence)::bigint,
 'throughSequence',COALESCE((SELECT max(sequence) FROM life_event WHERE world_id=w.id AND kind IN ('town_command','town_activity','town_conversation','goal_reached')),0),
 'total',(SELECT count(*) FROM life_event WHERE world_id=w.id AND sequence>sqlc.arg(since_sequence) AND kind IN ('town_command','town_activity','town_conversation','goal_reached')),
 'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'sequence',e.sequence,'tick',e.tick,'actionId',e.action_id,'agentId',e.agent_id,'kind',e.kind,'payload',e.payload,'occurredAt',e.occurred_at) ORDER BY e.sequence DESC)
  FROM (SELECT * FROM life_event WHERE world_id=w.id AND sequence>sqlc.arg(since_sequence) AND kind IN ('town_command','town_activity','town_conversation','goal_reached') ORDER BY sequence DESC LIMIT 200) e),'[]'::jsonb)
)::jsonb AS history FROM life_world w WHERE w.workspace_id=sqlc.arg(workspace_id);
