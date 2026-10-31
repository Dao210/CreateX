-- name: GetLifeSnapshot :one
SELECT jsonb_build_object(
 'world', jsonb_build_object('id',w.id,'workspaceId',w.workspace_id,'tick',w.tick,'tickMs',w.tick_ms,'updatedAt',w.updated_at),
 'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',a.id,'name',a.name,'position',jsonb_build_object('x',a.x,'y',a.y),
   'energy',a.energy,'fullness',a.fullness,'social',a.social,'personality',a.personality,'goal',a.goal
 ) ORDER BY a.id) FROM life_agent a WHERE a.world_id=w.id),'[]'::jsonb),
 'resources', COALESCE((SELECT jsonb_agg(jsonb_build_object('owner',r.owner,'kind',r.kind,'amount',r.amount) ORDER BY r.owner,r.kind)
   FROM life_resource r WHERE r.world_id=w.id),'[]'::jsonb),
 'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'agentId',c.agent_id,'intent',c.intent,'reason',c.reason,
   'startedTick',c.started_tick,'dueTick',c.due_tick,'status',c.status) ORDER BY c.agent_id)
   FROM life_action c WHERE c.world_id=w.id AND c.status='running'),'[]'::jsonb),
 'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'tick',e.tick,'actionId',e.action_id,
   'agentId',e.agent_id,'kind',e.kind,'payload',e.payload,'occurredAt',e.occurred_at) ORDER BY e.tick DESC,e.id)
   FROM (SELECT * FROM life_event WHERE world_id=w.id ORDER BY tick DESC,id LIMIT 80) e),'[]'::jsonb)
)::jsonb AS snapshot
FROM life_world w WHERE w.workspace_id=$1;

-- name: LockLifeWorldForDeletion :exec
SELECT 1 FROM life_world WHERE workspace_id=$1 FOR UPDATE;

-- name: DeleteLifeWorldState :exec
WITH deleted_events AS (
 DELETE FROM life_event WHERE world_id IN (SELECT life_world.id FROM life_world WHERE life_world.workspace_id=$1)
), deleted_actions AS (
 DELETE FROM life_action WHERE world_id IN (SELECT life_world.id FROM life_world WHERE life_world.workspace_id=$1)
), deleted_resources AS (
 DELETE FROM life_resource WHERE world_id IN (SELECT life_world.id FROM life_world WHERE life_world.workspace_id=$1)
), deleted_agents AS (
 DELETE FROM life_agent WHERE world_id IN (SELECT life_world.id FROM life_world WHERE life_world.workspace_id=$1)
)
DELETE FROM life_world WHERE life_world.workspace_id=$1;
