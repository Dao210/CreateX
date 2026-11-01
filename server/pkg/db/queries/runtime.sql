-- name: ListAgentRuntimes :many
SELECT * FROM agent_runtime
WHERE workspace_id = $1
ORDER BY created_at ASC;





-- name: ListAgentRuntimeIDsByWorkspace :many
SELECT id FROM agent_runtime
WHERE workspace_id = $1
ORDER BY id ASC;





-- name: ListVisibleAgentRuntimes :many
SELECT * FROM agent_runtime
WHERE workspace_id = $1
  AND (owner_id = $2 OR visibility = 'public')
ORDER BY created_at ASC;





-- name: GetAgentRuntime :one
SELECT * FROM agent_runtime
WHERE id = $1;





-- name: GetAgentRuntimes :many
SELECT * FROM agent_runtime
WHERE id = ANY(@ids::uuid[]);





-- name: GetAgentRuntimeHeartbeatLeases :many
SELECT id, workspace_id, daemon_id, status, last_seen_at
FROM agent_runtime
WHERE id = ANY(@ids::uuid[]);





-- name: LockAgentRuntime :one
SELECT * FROM agent_runtime
WHERE id = $1
FOR UPDATE;





-- name: GetAgentRuntimeForWorkspace :one
SELECT * FROM agent_runtime
WHERE id = $1 AND workspace_id = $2;





-- name: UpsertAgentRuntime :one
INSERT INTO agent_runtime (
    workspace_id,
    daemon_id,
    name,
    runtime_mode,
    provider,
    status,
    device_info,
    metadata,
    owner_id,
    last_seen_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
ON CONFLICT (workspace_id, daemon_id, provider) WHERE profile_id IS NULL
DO UPDATE SET
    name = EXCLUDED.name,
    runtime_mode = EXCLUDED.runtime_mode,
    status = EXCLUDED.status,
    device_info = EXCLUDED.device_info,
    metadata = EXCLUDED.metadata,
    owner_id = COALESCE(EXCLUDED.owner_id, agent_runtime.owner_id),
    last_seen_at = now(),
    updated_at = now()
RETURNING *, (xmax = 0) AS inserted;





-- name: UpsertAgentRuntimeWithProfile :one
INSERT INTO agent_runtime (
    workspace_id,
    daemon_id,
    name,
    runtime_mode,
    provider,
    status,
    device_info,
    metadata,
    owner_id,
    profile_id,
    last_seen_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
ON CONFLICT (workspace_id, daemon_id, profile_id) WHERE profile_id IS NOT NULL
DO UPDATE SET
    name = EXCLUDED.name,
    runtime_mode = EXCLUDED.runtime_mode,
    provider = EXCLUDED.provider,
    status = EXCLUDED.status,
    device_info = EXCLUDED.device_info,
    metadata = EXCLUDED.metadata,
    owner_id = COALESCE(EXCLUDED.owner_id, agent_runtime.owner_id),
    last_seen_at = now(),
    updated_at = now()
RETURNING *, (xmax = 0) AS inserted;





-- name: UpdateAgentRuntimeVisibility :one
UPDATE agent_runtime
SET visibility = @visibility, updated_at = now()
WHERE id = @id
RETURNING *;





-- name: UpdateAgentRuntimeCustomName :one
UPDATE agent_runtime
SET custom_name = @custom_name, updated_at = now()
WHERE id = @id
RETURNING *;





-- name: UpdateAgentRuntimeCustomNameByDaemon :many
UPDATE agent_runtime
SET custom_name = @custom_name, updated_at = now()
WHERE workspace_id = @workspace_id
  AND daemon_id = @daemon_id
  AND (@owner_id::uuid IS NULL OR owner_id = @owner_id)
RETURNING *;





-- name: ListDaemonCustomNames :many
SELECT custom_name FROM agent_runtime
WHERE workspace_id = @workspace_id
  AND daemon_id = @daemon_id
  AND id <> @exclude_id;






-- name: TouchAgentRuntimeLastSeen :execrows
UPDATE agent_runtime
SET last_seen_at = now()
WHERE id = $1 AND status = 'online';





-- name: TouchAgentRuntimesLastSeenBatch :many
UPDATE agent_runtime
SET last_seen_at = now()
WHERE id = ANY(@ids::uuid[]) AND status = 'online'
RETURNING id;





-- name: MarkAgentRuntimeOnline :one
UPDATE agent_runtime
SET status = 'online', last_seen_at = now(), updated_at = now()
WHERE id = $1
RETURNING *;





-- name: MarkAgentRuntimeOnlineIfOffline :execrows
UPDATE agent_runtime
SET status = 'online', last_seen_at = now(), updated_at = now()
WHERE id = $1 AND status <> 'online';





-- name: SetAgentRuntimeOffline :exec
UPDATE agent_runtime
SET status = 'offline', updated_at = now()
WHERE id = $1;





-- name: SetAgentRuntimeOfflineWithReason :exec
UPDATE agent_runtime
SET status = 'offline',
    metadata = metadata || jsonb_build_object('offline_reason', @offline_reason::jsonb),
    updated_at = now()
WHERE id = $1;





-- name: SelectStaleOnlineRuntimes :many
SELECT id, workspace_id, owner_id, daemon_id, provider FROM agent_runtime
WHERE status = 'online'
  AND last_seen_at < now() - make_interval(secs => @stale_seconds::double precision);





-- name: MarkRuntimesOfflineByIDs :many
UPDATE agent_runtime
SET status = 'offline', updated_at = now()
WHERE status = 'online'
  AND id = ANY(@ids::uuid[])
  AND last_seen_at < now() - make_interval(secs => @stale_seconds::double precision)
RETURNING id, workspace_id, owner_id, daemon_id, provider;





-- name: FailTasksForOfflineRuntimes :many
WITH victims AS (
  SELECT task.id
  FROM agent_task_queue task
  JOIN agent_runtime runtime ON runtime.id = task.runtime_id
  WHERE task.status IN ('dispatched', 'running', 'waiting_local_directory')
    AND runtime.status = 'offline'
    AND COALESCE(runtime.last_seen_at, runtime.updated_at) <
        now() - make_interval(secs => @reconnect_grace_secs::double precision)
  ORDER BY COALESCE(runtime.last_seen_at, runtime.updated_at), task.created_at
  LIMIT @max_per_tick::int
  FOR UPDATE OF task SKIP LOCKED
)
UPDATE agent_task_queue AS task
SET status = 'failed', completed_at = now(), error = 'runtime went offline',
    failure_reason = 'runtime_offline',
    wait_reason = NULL
FROM victims
WHERE task.id = victims.id
  AND task.status IN ('dispatched', 'running', 'waiting_local_directory')
RETURNING task.*;





-- name: ListAgentRuntimesByOwner :many
SELECT * FROM agent_runtime
WHERE workspace_id = $1 AND owner_id = $2
ORDER BY created_at ASC;





-- name: ForceOfflineRuntimesByIDs :many
UPDATE agent_runtime
SET status = 'offline', updated_at = now()
WHERE id = ANY(@runtime_ids::uuid[]) AND status = 'online'
RETURNING id, workspace_id, owner_id, daemon_id, provider;





-- name: CancelAgentTasksByRuntimeOrAgent :many
UPDATE agent_task_queue
SET status = 'cancelled', completed_at = now(),
    cancelled_by_type = 'system', cancelled_by_id = NULL, cancelled_by_name = NULL
WHERE (runtime_id = ANY(@runtime_ids::uuid[]) OR agent_id = ANY(@agent_ids::uuid[]))
  AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
RETURNING *;





-- name: CountUndrainedTasksByRuntimeOrAgent :one
SELECT count(*) FROM agent_task_queue
WHERE (runtime_id = ANY(@runtime_ids::uuid[]) OR agent_id = ANY(@agent_ids::uuid[]))
  AND completed_at IS NULL;





-- name: UnbindTasksFromRuntime :execrows
UPDATE agent_task_queue
SET runtime_id = NULL
WHERE runtime_id = $1 AND completed_at IS NOT NULL;





-- name: UnbindUserAgentsFromRuntime :many
UPDATE agent
SET runtime_id = NULL, updated_at = now()
WHERE runtime_id = $1 AND kind = 'user'
RETURNING *;





-- name: DeleteAgentRuntime :exec
DELETE FROM agent_runtime WHERE id = $1;





-- name: DeleteSystemAgentsByRuntime :exec
DELETE FROM agent WHERE runtime_id = $1 AND kind = 'system';





-- name: CountActiveAgentsByRuntime :one
SELECT count(*) FROM agent WHERE runtime_id = $1 AND archived_at IS NULL;





-- name: FindLegacyRuntimesByDaemonID :many
SELECT * FROM agent_runtime
WHERE workspace_id = @workspace_id
  AND provider = @provider
  AND LOWER(daemon_id) = LOWER(@daemon_id);





-- name: ReassignAgentsToRuntime :execrows
UPDATE agent
SET runtime_id = @new_runtime_id
WHERE runtime_id = @old_runtime_id;





-- name: LockWorkspaceForRuntimeMerge :exec
SELECT 1 FROM workspace w
WHERE w.id IN (
    SELECT r.workspace_id FROM agent_runtime r WHERE r.id = ANY(@runtime_ids::uuid[])
)
ORDER BY w.id
FOR KEY SHARE;





-- name: LockRuntimesForMerge :many
SELECT id FROM agent_runtime
WHERE id = ANY(@runtime_ids::uuid[])
ORDER BY id
FOR UPDATE;





-- name: ReassignTasksToRuntime :one
WITH fence AS MATERIALIZED (
    SELECT lock_task_owner_rows(NULL, @new_runtime_id) AS ok
),
reassigned AS (
    UPDATE agent_task_queue
    SET runtime_id = @new_runtime_id
    WHERE runtime_id = @old_runtime_id
      AND (SELECT ok FROM fence)
    RETURNING id
)
SELECT
    (SELECT ok FROM fence) AS fence_ok,
    (SELECT count(*) FROM reassigned) AS reassigned_tasks;





-- name: RecordRuntimeLegacyDaemonID :exec
UPDATE agent_runtime
SET legacy_daemon_id = COALESCE(legacy_daemon_id, $2)
WHERE id = $1;





-- name: ListStaleOfflineRuntimeGCCandidates :many
SELECT id FROM agent_runtime
WHERE status = 'offline'
  AND last_seen_at < now() - make_interval(secs => @stale_seconds::double precision)
  AND NOT EXISTS (
    SELECT 1
    FROM agent
    WHERE agent.runtime_id = agent_runtime.id
      AND agent.kind = 'user'
      AND agent.archived_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM agent_task_queue
    WHERE agent_task_queue.runtime_id = agent_runtime.id
      AND agent_task_queue.completed_at IS NULL
  )
ORDER BY last_seen_at ASC, id ASC
LIMIT @max_per_tick::int;





-- name: IsAgentRuntimeEligibleForGC :one
SELECT EXISTS (
  SELECT 1 FROM agent_runtime
  WHERE agent_runtime.id = @id
    AND status = 'offline'
    AND last_seen_at < now() - make_interval(secs => @stale_seconds::double precision)
    AND NOT EXISTS (
      SELECT 1
      FROM agent
      WHERE agent.runtime_id = agent_runtime.id
        AND agent.kind = 'user'
        AND agent.archived_at IS NULL
    )
) AS eligible;





-- name: CountTasksByRuntime :one
SELECT count(*) FROM agent_task_queue WHERE runtime_id = $1;
