-- name: ListAgents :many
SELECT * FROM agent
WHERE workspace_id = $1 AND archived_at IS NULL AND kind = 'user'
ORDER BY created_at ASC;





-- name: ListAllAgents :many
SELECT * FROM agent
WHERE workspace_id = $1 AND kind = 'user'
ORDER BY created_at ASC;





-- name: ListAllAgentsAnyKind :many
SELECT * FROM agent
WHERE workspace_id = $1
ORDER BY created_at ASC;





-- name: GetAgent :one
SELECT * FROM agent
WHERE id = $1;





-- name: GetAgentForUpdate :one
SELECT * FROM agent
WHERE id = $1
FOR UPDATE;





-- name: GetAgentInWorkspace :one
SELECT * FROM agent
WHERE id = $1 AND workspace_id = $2 AND kind = 'user';





-- name: LockAgentForAutopilotAssignment :one
SELECT * FROM agent
WHERE id = $1 AND workspace_id = $2 AND kind = 'user'
FOR SHARE;





-- name: CreateAgent :one
INSERT INTO agent (
    workspace_id, name, description, avatar_url, runtime_mode,
    runtime_config, runtime_id, visibility, max_concurrent_tasks, owner_id,
    instructions, custom_env, custom_args, mcp_config, model, thinking_level,
    service_tier, conversation_starters,
    composio_toolkit_allowlist, permission_mode
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16,
    $17, COALESCE(sqlc.narg('conversation_starters')::jsonb, '[]'::jsonb),
    sqlc.narg('composio_toolkit_allowlist')::text[],
    COALESCE(sqlc.narg('permission_mode'), 'private')
)
RETURNING *;





-- name: CreateAgentBuilder :one
INSERT INTO agent (
    workspace_id, name, description, runtime_mode, runtime_config, runtime_id,
    visibility, permission_mode, max_concurrent_tasks, owner_id, instructions,
    custom_env, custom_args, model, kind, system_key
) VALUES (
    @workspace_id, @name, '', @runtime_mode, '{}'::jsonb, @runtime_id,
    'private', 'private', 1, @owner_id, @instructions,
    '{}'::jsonb, '[]'::jsonb, sqlc.narg('model'), 'system', @system_key
)
RETURNING *;





-- name: DeleteSystemAgentByID :exec
DELETE FROM agent
WHERE id = $1 AND kind = 'system' AND system_key LIKE 'agent_builder:%';





-- name: RebindAgentBuilderRuntime :one
UPDATE agent
SET runtime_id = @runtime_id,
    runtime_mode = @runtime_mode,
    model = sqlc.narg('model'),
    updated_at = now()
WHERE id = @id AND kind = 'system' AND system_key LIKE 'agent_builder:%'
RETURNING *;





-- name: UpdateAgent :one
UPDATE agent SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    avatar_url = COALESCE(sqlc.narg('avatar_url'), avatar_url),
    runtime_config = COALESCE(sqlc.narg('runtime_config'), runtime_config),
    runtime_mode = COALESCE(sqlc.narg('runtime_mode'), runtime_mode),
    runtime_id = COALESCE(sqlc.narg('runtime_id'), runtime_id),
    visibility = COALESCE(sqlc.narg('visibility'), visibility),
    permission_mode = COALESCE(sqlc.narg('permission_mode'), permission_mode),
    status = COALESCE(sqlc.narg('status'), status),
    max_concurrent_tasks = COALESCE(sqlc.narg('max_concurrent_tasks'), max_concurrent_tasks),
    instructions = COALESCE(sqlc.narg('instructions'), instructions),
    custom_env = COALESCE(sqlc.narg('custom_env'), custom_env),
    custom_args = COALESCE(sqlc.narg('custom_args'), custom_args),
    mcp_config = COALESCE(sqlc.narg('mcp_config'), mcp_config),
    model = COALESCE(sqlc.narg('model'), model),
    thinking_level = COALESCE(sqlc.narg('thinking_level'), thinking_level),
    service_tier = COALESCE(sqlc.narg('service_tier'), service_tier),
    conversation_starters = COALESCE(sqlc.narg('conversation_starters'), conversation_starters),
    composio_toolkit_allowlist = COALESCE(sqlc.narg('composio_toolkit_allowlist')::text[], composio_toolkit_allowlist),
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: ClearAgentComposioToolkitAllowlist :one
UPDATE agent SET composio_toolkit_allowlist = NULL, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: ClearAgentThinkingLevel :one
UPDATE agent SET thinking_level = NULL, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: ClearAgentServiceTier :one
UPDATE agent SET service_tier = NULL, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: ClearAgentMcpConfig :one
UPDATE agent SET mcp_config = NULL, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: UpdateAgentCustomEnv :one
UPDATE agent
SET custom_env = $2, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: UpdateAgentDisabledRuntimeSkills :one
UPDATE agent
SET disabled_runtime_skills = $2, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: ArchiveAgent :one
UPDATE agent SET archived_at = now(), archived_by = $2, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: ArchiveAgentsByRuntime :many
UPDATE agent
SET archived_at = now(), archived_by = @archived_by, updated_at = now()
WHERE runtime_id = ANY(@runtime_ids::uuid[]) AND archived_at IS NULL
  AND (system_key IS NULL OR system_key = '')
RETURNING *;





-- name: ArchiveAgentsByIDs :many
UPDATE agent
SET archived_at = now(), archived_by = @archived_by, updated_at = now()
WHERE id = ANY(@agent_ids::uuid[]) AND archived_at IS NULL
RETURNING *;





-- name: ListActiveAgentsByRuntime :many
SELECT * FROM agent
WHERE runtime_id = $1 AND archived_at IS NULL AND kind = 'user'
ORDER BY name ASC;





-- name: ListActiveAgentsByRuntimeForUpdate :many
SELECT * FROM agent
WHERE runtime_id = $1 AND archived_at IS NULL AND kind = 'user'
ORDER BY name ASC
FOR UPDATE;





-- name: ListUserAgentIDsByRuntime :many
SELECT id FROM agent
WHERE runtime_id = $1 AND kind = 'user'
ORDER BY id;





-- name: ListUserAgentsByRuntimeForUpdate :many
SELECT * FROM agent
WHERE runtime_id = $1 AND kind = 'user'
ORDER BY id
FOR UPDATE;





-- name: RestoreAgent :one
UPDATE agent SET archived_at = NULL, archived_by = NULL, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: ListAgentTasks :many
SELECT * FROM agent_task_queue
WHERE agent_id = @agent_id
  AND (created_at, id) < (@before_created_at::timestamptz, @before_id::uuid)
ORDER BY created_at DESC, id DESC
LIMIT @page_limit;





-- name: CreateRetryTask :one
INSERT INTO agent_task_queue(
agent_id,runtime_id,chat_session_id,autopilot_run_id,status,priority,trigger_summary,context,session_id,work_dir,
attempt,max_attempts,parent_task_id,force_fresh_session,originator_user_id,accountable_user_id,runtime_mcp_overlay,runtime_connected_apps,
originator_source,delegated_from_task_id,rule_version_id,trigger_evidence_kind,trigger_evidence_ref_id,retry_of_task_id,
chat_input_task_id,fire_at,channel_context_revision,handoff_note,id)
SELECT p.agent_id,p.runtime_id,p.chat_session_id,p.autopilot_run_id,
CASE WHEN sqlc.narg(fire_at)::timestamptz IS NOT NULL THEN 'deferred' ELSE 'queued' END,
CASE WHEN p.chat_session_id IS NOT NULL THEN GREATEST(p.priority,3) ELSE p.priority END,p.trigger_summary,p.context,
CASE WHEN p.failure_reason IS NOT DISTINCT FROM 'codex_semantic_inactivity' THEN NULL ELSE p.session_id END,p.work_dir,
p.attempt+1,COALESCE(sqlc.narg(max_attempts)::int,p.max_attempts),p.id,p.failure_reason IS NOT DISTINCT FROM 'codex_semantic_inactivity',
p.originator_user_id,p.accountable_user_id,sqlc.narg(runtime_mcp_overlay),sqlc.narg(runtime_connected_apps),
p.originator_source,p.delegated_from_task_id,p.rule_version_id,p.trigger_evidence_kind,p.trigger_evidence_ref_id,p.id,
p.chat_input_task_id,sqlc.narg(fire_at),p.channel_context_revision,p.handoff_note,COALESCE(sqlc.narg('new_task_id')::uuid,gen_random_uuid())
FROM agent_task_queue p WHERE p.id=$1 AND lock_task_owner_rows(p.agent_id,p.runtime_id)
ON CONFLICT DO NOTHING RETURNING *;


-- name: CancelAgentTasksByAgent :many
UPDATE agent_task_queue
SET status = 'cancelled', completed_at = now(), prepare_lease_expires_at = NULL,
    cancelled_by_type = 'system', cancelled_by_id = NULL, cancelled_by_name = NULL
WHERE agent_id = $1 AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
RETURNING *;





-- name: CancelAgentTasksByChatSession :many
UPDATE agent_task_queue
SET status = 'cancelled', completed_at = now(), prepare_lease_expires_at = NULL,
    cancelled_by_type = 'system', cancelled_by_id = NULL, cancelled_by_name = NULL
WHERE chat_session_id = $1 AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
RETURNING *;





-- name: GetAgentTask :one
SELECT * FROM agent_task_queue
WHERE id = $1;





-- name: GetAgentTaskStatus :one
SELECT atq.status, a.workspace_id
FROM agent_task_queue atq
JOIN agent a ON a.id = atq.agent_id
WHERE atq.id = $1;





-- name: GetAgentTaskForDelegatedFailureUpdate :one
SELECT * FROM agent_task_queue
WHERE id = $1
FOR UPDATE;





-- name: HasRetryTaskForParent :one
SELECT count(*) > 0
FROM agent_task_queue
WHERE parent_task_id = $1
  AND status <> 'cancelled';





-- name: GetAgentTaskInWorkspace :one
SELECT atq.* FROM agent_task_queue atq
JOIN agent a ON a.id = atq.agent_id
WHERE atq.id = $1 AND a.workspace_id = $2;





-- name: ClaimAgentTask :one
UPDATE agent_task_queue
SET status = 'dispatched',
    dispatched_at = now(),
    prepare_lease_expires_at = now() + make_interval(secs => @prepare_lease_secs::double precision)
WHERE id = (
    SELECT atq.id FROM agent_task_queue atq
    WHERE atq.agent_id = @agent_id
      AND atq.runtime_id = @runtime_id
      AND atq.status = 'queued'
      AND EXISTS (
          SELECT 1
          FROM agent a
          JOIN agent_runtime r ON r.id = atq.runtime_id
          WHERE a.id = atq.agent_id
            AND a.runtime_id = atq.runtime_id
            AND (
                r.visibility = 'public'
                OR r.visibility = 'private'
            )
            AND r.status = 'online'
            AND COALESCE(r.last_seen_at, r.updated_at) >=
                now() - make_interval(secs => @runtime_stale_secs::double precision)
      )
      AND NOT EXISTS (
          SELECT 1 FROM agent_task_queue active
          WHERE active.agent_id = atq.agent_id
            AND active.status IN ('dispatched', 'running', 'waiting_local_directory')
            AND active.chat_session_id = atq.chat_session_id
      )
    ORDER BY atq.priority DESC, atq.created_at ASC, atq.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING *;





-- name: RequeueAgentTaskAfterClaimFailure :one
UPDATE agent_task_queue
SET status = 'queued',
    dispatched_at = NULL,
    prepare_lease_expires_at = NULL
WHERE id = @task_id
  AND runtime_id = @runtime_id
  AND status = 'dispatched'
  AND started_at IS NULL
  AND dispatched_at = @dispatched_at
RETURNING *;





-- name: ReclaimStaleDispatchedTaskForRuntime :one
UPDATE agent_task_queue
SET dispatched_at = now(),
    prepare_lease_expires_at = now() + make_interval(secs => @prepare_lease_secs::double precision)
WHERE id = (
    SELECT atq.id FROM agent_task_queue atq
    WHERE atq.runtime_id = $1
      AND atq.status = 'dispatched'
      AND atq.started_at IS NULL
      AND atq.dispatched_at < now() - make_interval(secs => @claim_recovery_secs::double precision)
      AND (atq.prepare_lease_expires_at IS NULL OR atq.prepare_lease_expires_at < now())
      AND EXISTS (
          SELECT 1
          FROM agent a
          JOIN agent_runtime r ON r.id = atq.runtime_id
          WHERE a.id = atq.agent_id
            AND a.runtime_id = atq.runtime_id
            AND (
                r.visibility = 'public'
                OR (
                    r.visibility = 'private'
                    AND (
                        r.owner_id IS NULL
                        OR a.owner_id IS NULL
                        OR r.owner_id = a.owner_id
                    )
                )
            )
            AND r.status = 'online'
            AND COALESCE(r.last_seen_at, r.updated_at) >=
                now() - make_interval(secs => @runtime_stale_secs::double precision)
      )
    ORDER BY atq.priority DESC, atq.dispatched_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING *;





-- name: ReclaimStaleDispatchedTasksForRuntimes :many
UPDATE agent_task_queue
SET dispatched_at = now(),
    prepare_lease_expires_at = now() + make_interval(secs => @prepare_lease_secs::double precision)
WHERE id IN (
    SELECT atq.id FROM agent_task_queue atq
    WHERE atq.runtime_id = ANY(@runtime_ids::uuid[])
      AND atq.status = 'dispatched'
      AND atq.started_at IS NULL
      AND atq.dispatched_at < now() - make_interval(secs => @claim_recovery_secs::double precision)
      AND (atq.prepare_lease_expires_at IS NULL OR atq.prepare_lease_expires_at < now())
      AND EXISTS (
          SELECT 1
          FROM agent a
          JOIN agent_runtime r ON r.id = atq.runtime_id
          WHERE a.id = atq.agent_id
            AND a.runtime_id = atq.runtime_id
            AND (
                r.visibility = 'public'
                OR (
                    r.visibility = 'private'
                    AND (
                        r.owner_id IS NULL
                        OR a.owner_id IS NULL
                        OR r.owner_id = a.owner_id
                    )
                )
            )
            AND r.status = 'online'
            AND COALESCE(r.last_seen_at, r.updated_at) >=
                now() - make_interval(secs => @runtime_stale_secs::double precision)
      )
    ORDER BY atq.priority DESC, atq.dispatched_at ASC
    LIMIT @max_tasks::int
    FOR UPDATE SKIP LOCKED
)
RETURNING *;





-- name: ExtendAgentTaskPrepareLease :one
UPDATE agent_task_queue
SET prepare_lease_expires_at = now() + make_interval(secs => @lease_secs::double precision)
WHERE id = $1
  AND runtime_id = $2
  AND status IN ('dispatched', 'waiting_local_directory')
  AND started_at IS NULL
RETURNING *;





-- name: StartAgentTask :one
UPDATE agent_task_queue
SET status = 'running',
    started_at = now(),
    wait_reason = NULL,
    prepare_lease_expires_at = NULL
WHERE agent_task_queue.id = $1 AND agent_task_queue.status IN ('dispatched', 'waiting_local_directory')
RETURNING *;





-- name: LockAgentTaskStartClaim :one
SELECT * FROM agent_task_queue
WHERE id = $1 AND runtime_id = $2 AND dispatched_at = $3
  AND status IN ('dispatched', 'waiting_local_directory', 'running')
FOR UPDATE;





-- name: MarkAgentTaskWaitingLocalDirectory :one
UPDATE agent_task_queue
SET status = 'waiting_local_directory',
    wait_reason = $2,
    prepare_lease_expires_at = now() + make_interval(secs => @prepare_lease_secs::double precision)
WHERE id = $1 AND status = 'dispatched'
RETURNING *;





-- name: CompleteAgentTask :one
UPDATE agent_task_queue
SET status = 'completed', completed_at = now(), result = $2,
    session_id = CASE WHEN sqlc.arg('session_rollout_missing') THEN NULL ELSE $3 END,
    work_dir = $4,
    durable_work_dir = COALESCE(sqlc.narg('durable_work_dir'), durable_work_dir),
    branch_name = COALESCE(sqlc.narg('branch_name'), branch_name),
    session_rollout_missing = sqlc.arg('session_rollout_missing'),
    retired_session_id = COALESCE(sqlc.narg('retired_session_id'), retired_session_id),
    prepare_lease_expires_at = NULL
WHERE id = $1 AND status = 'running'
RETURNING *;





-- name: GetLatestChatTaskRolloutMissing :one
SELECT COALESCE(session_rollout_missing, FALSE) FROM agent_task_queue
WHERE chat_session_id = sqlc.arg('chat_session_id')
  AND (
    sqlc.narg('channel_context_revision')::bigint IS NULL
    OR COALESCE(channel_context_revision, 1) = sqlc.narg('channel_context_revision')::bigint
  )
  AND status IN ('completed', 'failed')
  AND started_at IS NOT NULL
ORDER BY COALESCE(completed_at, started_at, dispatched_at, created_at) DESC
LIMIT 1;





-- name: FailAgentTask :one
UPDATE agent_task_queue
SET status = 'failed',
    completed_at = now(),
    error = $2,
    failure_reason = COALESCE(sqlc.narg('failure_reason'), 'agent_error'),
    session_id = CASE WHEN sqlc.arg('session_rollout_missing') THEN NULL ELSE COALESCE(sqlc.narg('session_id'), session_id) END,
    work_dir = COALESCE(sqlc.narg('work_dir'), work_dir),
    durable_work_dir = COALESCE(sqlc.narg('durable_work_dir'), durable_work_dir),
    branch_name = COALESCE(sqlc.narg('branch_name'), branch_name),
    session_rollout_missing = sqlc.arg('session_rollout_missing'),
    retired_session_id = COALESCE(sqlc.narg('retired_session_id'), retired_session_id),
    prepare_lease_expires_at = NULL
WHERE id = $1 AND status IN ('dispatched', 'running', 'waiting_local_directory')
RETURNING *;





-- name: UpdateAgentTaskSession :exec
UPDATE agent_task_queue
SET session_id = COALESCE(sqlc.narg('session_id'), session_id),
    work_dir  = COALESCE(sqlc.narg('work_dir'), work_dir)
WHERE id = $1
  AND (
    status IN ('dispatched', 'running')
    OR (status = 'cancelled' AND session_id IS NULL)
  );





-- name: RecoverOrphanedTasksForRuntime :many
UPDATE agent_task_queue
SET status = 'failed',
    completed_at = now(),
    error = 'daemon restarted while task was in flight',
    failure_reason = 'runtime_recovery',
    wait_reason = NULL,
    prepare_lease_expires_at = NULL
WHERE runtime_id = $1 AND status IN ('dispatched', 'running', 'waiting_local_directory')
RETURNING *;





-- name: FailStaleTasks :many
UPDATE agent_task_queue
SET status = 'failed', completed_at = now(), error = 'task timed out',
    failure_reason = 'timeout',
    prepare_lease_expires_at = NULL
WHERE (
    status = 'dispatched'
    AND dispatched_at < now() - make_interval(secs => @dispatch_timeout_secs::double precision)
    AND (prepare_lease_expires_at IS NULL OR prepare_lease_expires_at < now())
    AND (
      runtime_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM agent_runtime r
        WHERE r.id = agent_task_queue.runtime_id
      )
      OR EXISTS (
        SELECT 1 FROM agent_runtime r
        WHERE r.id = agent_task_queue.runtime_id
          AND (
            (
              r.status = 'online'
              AND COALESCE(r.last_seen_at, r.updated_at) >=
                  now() - make_interval(secs => @runtime_stale_secs::double precision)
            )
            OR COALESCE(r.last_seen_at, r.updated_at) <
               now() - make_interval(secs => @runtime_reconnect_grace_secs::double precision)
          )
      )
    )
  )
   OR (
    status = 'running'
    AND started_at < now() - make_interval(secs => @running_timeout_secs::double precision)
    AND (
      runtime_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM agent_runtime r
        WHERE r.id = agent_task_queue.runtime_id
          AND COALESCE(r.last_seen_at, r.updated_at) >=
              now() - make_interval(secs => @runtime_reconnect_grace_secs::double precision)
      )
    )
  )
RETURNING *;





-- name: ExpireStaleQueuedTasks :many
WITH victims AS (
    SELECT id FROM agent_task_queue
    WHERE status = 'queued' AND context->>'wakeup_id' IS NULL
      AND created_at < now() - make_interval(secs => @reconnect_grace_secs::double precision)
      AND (
          runtime_id IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM agent_runtime r WHERE r.id = agent_task_queue.runtime_id
          )
          OR EXISTS (
              SELECT 1 FROM agent_runtime r
              WHERE r.id = agent_task_queue.runtime_id
                AND COALESCE(r.last_seen_at, r.updated_at) <
                    now() - make_interval(secs => @reconnect_grace_secs::double precision)
          )
      )
      AND NOT EXISTS (
          SELECT 1 FROM agent_task_queue retry_parent
          WHERE retry_parent.id = agent_task_queue.parent_task_id
            AND retry_parent.failure_reason = 'runtime_offline'
      )
    ORDER BY created_at ASC
    LIMIT @max_per_tick::int
    FOR UPDATE SKIP LOCKED
)
UPDATE agent_task_queue t
SET status = 'failed',
    completed_at = now(),
    error = 'runtime unavailable while task was queued',
    failure_reason = 'queued_expired',
    prepare_lease_expires_at = NULL
FROM victims v
WHERE t.id = v.id
  AND t.status = 'queued'
  AND t.created_at < now() - make_interval(secs => @reconnect_grace_secs::double precision)
  AND (
      t.runtime_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM agent_runtime r WHERE r.id = t.runtime_id)
      OR EXISTS (
          SELECT 1 FROM agent_runtime r
          WHERE r.id = t.runtime_id
            AND COALESCE(r.last_seen_at, r.updated_at) <
                now() - make_interval(secs => @reconnect_grace_secs::double precision)
      )
  )
  AND NOT EXISTS (
      SELECT 1 FROM agent_task_queue retry_parent
      WHERE retry_parent.id = t.parent_task_id
        AND retry_parent.failure_reason = 'runtime_offline'
  )
RETURNING t.*;





-- name: FailExpiredRuntimeReconnectRetries :many
WITH victims AS (
    SELECT retry.id
    FROM agent_task_queue retry
    JOIN agent_task_queue parent ON parent.id = retry.parent_task_id
    WHERE retry.status = 'deferred'
      AND retry.fire_at < now() - make_interval(secs => @reconnect_grace_secs::double precision)
      AND parent.failure_reason = 'runtime_offline'
      AND NOT EXISTS (
          SELECT 1 FROM agent_runtime runtime
          WHERE runtime.id = retry.runtime_id
            AND runtime.status = 'online'
            AND COALESCE(runtime.last_seen_at, runtime.updated_at) >=
                now() - make_interval(secs => @runtime_stale_secs::double precision)
      )
    ORDER BY retry.fire_at, retry.created_at
    LIMIT @max_per_tick::int
    FOR UPDATE OF retry SKIP LOCKED
)
UPDATE agent_task_queue AS retry
SET status = 'failed',
    completed_at = now(),
    error = 'runtime did not reconnect within the configured grace period',
    failure_reason = 'runtime_reconnect_timeout',
    wait_reason = NULL,
    prepare_lease_expires_at = NULL
FROM victims
WHERE retry.id = victims.id
  AND retry.status = 'deferred'
  AND retry.fire_at < now() - make_interval(secs => @reconnect_grace_secs::double precision)
  AND EXISTS (
      SELECT 1 FROM agent_task_queue parent
      WHERE parent.id = retry.parent_task_id
        AND parent.failure_reason = 'runtime_offline'
  )
  AND NOT EXISTS (
      SELECT 1 FROM agent_runtime runtime
      WHERE runtime.id = retry.runtime_id
        AND runtime.status = 'online'
        AND COALESCE(runtime.last_seen_at, runtime.updated_at) >=
            now() - make_interval(secs => @runtime_stale_secs::double precision)
  )
RETURNING retry.*;





-- name: CancelAgentTask :one
UPDATE agent_task_queue
SET status = 'cancelled', completed_at = now(), prepare_lease_expires_at = NULL,
    cancelled_by_type = 'system', cancelled_by_id = NULL, cancelled_by_name = NULL
WHERE id = $1 AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
RETURNING *;





-- name: CancelAgentTaskByUser :one
UPDATE agent_task_queue SET status='cancelled',completed_at=now(),prepare_lease_expires_at=NULL,cancelled_by_type=sqlc.arg('cancelled_by_type'),cancelled_by_id=sqlc.narg('cancelled_by_id'),cancelled_by_name=sqlc.narg('cancelled_by_name') WHERE id=sqlc.arg('id') AND status IN ('queued','dispatched','running','waiting_local_directory','deferred') RETURNING *;



-- name: SetAgentTaskBranchName :exec
UPDATE agent_task_queue
SET branch_name = COALESCE(branch_name, sqlc.arg('branch_name'))
WHERE id = sqlc.arg('id') AND status = 'cancelled';





-- name: SetAgentTaskDurableWorkDir :exec
UPDATE agent_task_queue
SET durable_work_dir = COALESCE(durable_work_dir, sqlc.arg('durable_work_dir'))
WHERE id = sqlc.arg('id') AND status = 'cancelled';





-- name: SetAgentTaskErrorIfEmpty :exec
UPDATE agent_task_queue
SET error = sqlc.arg('error'),
    failure_reason = COALESCE(failure_reason, sqlc.arg('failure_reason'))
WHERE id = sqlc.arg('id') AND (error IS NULL OR error = '') AND status = 'cancelled';





-- name: CancelAgentTaskWithReason :one
UPDATE agent_task_queue
SET status = 'cancelled',
    completed_at = now(),
    error = sqlc.arg('error'),
    failure_reason = sqlc.arg('failure_reason'),
    prepare_lease_expires_at = NULL,
    cancelled_by_type = 'system',
    cancelled_by_id = NULL,
    cancelled_by_name = NULL
WHERE id = sqlc.arg('id') AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
RETURNING *;





-- name: CancelQueuedAgentTask :one
UPDATE agent_task_queue
SET status = 'cancelled', completed_at = now(), prepare_lease_expires_at = NULL,
    cancelled_by_type = sqlc.arg('cancelled_by_type'),
    cancelled_by_id = sqlc.narg('cancelled_by_id'),
    cancelled_by_name = sqlc.narg('cancelled_by_name')
WHERE id = sqlc.arg('id')
  AND chat_session_id = sqlc.arg('chat_session_id')
  AND status = 'queued'
RETURNING *;





-- name: CancelQueuedAgentTasksForSession :many
WITH head AS MATERIALIZED (
  SELECT candidate.id
  FROM agent_task_queue AS candidate
  WHERE candidate.chat_session_id = $1
    AND candidate.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
    AND candidate.regenerate_quick_actions_for IS NULL
  ORDER BY
    CASE
      WHEN candidate.status IN ('dispatched', 'running', 'waiting_local_directory') THEN 0
      WHEN candidate.status = 'deferred' THEN 1
      ELSE 2
    END,
    candidate.priority DESC,
    candidate.created_at ASC,
    candidate.id ASC
  LIMIT 1
)
UPDATE agent_task_queue AS queued
SET status = 'cancelled', completed_at = now(), prepare_lease_expires_at = NULL,
    cancelled_by_type = 'system', cancelled_by_id = NULL, cancelled_by_name = NULL
WHERE queued.chat_session_id = $1
  AND queued.status = 'queued'
  AND queued.id IS DISTINCT FROM (SELECT id FROM head)
RETURNING queued.*;





-- name: MarkChatFinalizeDeferred :one
UPDATE agent_task_queue
SET chat_finalize_deferred_at = now()
WHERE id = $1
RETURNING *;





-- name: ClaimChatFinalizeDeferred :one
UPDATE agent_task_queue
SET chat_finalize_deferred_at = NULL
WHERE id = $1 AND chat_finalize_deferred_at IS NOT NULL
RETURNING *;





-- name: ListChatFinalizeDeferredExpired :many
SELECT * FROM agent_task_queue
WHERE chat_finalize_deferred_at IS NOT NULL
  AND chat_finalize_deferred_at < now() - make_interval(secs => @grace_secs::double precision)
ORDER BY chat_finalize_deferred_at
LIMIT @max_per_tick::int;





-- name: CountRunningTasks :one
SELECT count(*) FROM agent_task_queue
WHERE agent_id = $1 AND status IN ('dispatched', 'running', 'waiting_local_directory');





-- name: GetAgentForClaimUpdate :one
SELECT * FROM agent
WHERE id = $1
FOR UPDATE;





-- name: CountDelegatedFailureRecoveryTasks :one
SELECT count(*)
FROM agent_task_queue
WHERE trigger_evidence_kind = 'delegated_failure'
  AND trigger_evidence_ref_id = @failed_task_id;





-- name: ListPendingTasksByRuntime :many
SELECT * FROM agent_task_queue
WHERE runtime_id = $1 AND status IN ('queued', 'dispatched')
ORDER BY priority DESC, created_at ASC;





-- name: ListQueuedClaimCandidatesByRuntime :many
SELECT atq.* FROM agent_task_queue atq
WHERE atq.runtime_id = $1
  AND atq.status = 'queued'
  AND EXISTS (
      SELECT 1
      FROM agent a
      JOIN agent_runtime r ON r.id = atq.runtime_id
      WHERE a.id = atq.agent_id
        AND a.runtime_id = atq.runtime_id
        AND (
            r.visibility = 'public'
            OR r.visibility = 'private'
        )
  )
ORDER BY atq.priority DESC, atq.created_at ASC;





-- name: PromoteDueDeferredTasksForRuntime :many
UPDATE agent_task_queue t SET status='queued' WHERE t.runtime_id= @runtime_id AND t.status='deferred' AND t.fire_at<=now()
AND EXISTS(SELECT 1 FROM agent_runtime r WHERE r.id=t.runtime_id AND r.status='online' AND COALESCE(r.last_seen_at,r.updated_at)>=now()-make_interval(secs => @runtime_stale_secs::double precision)) RETURNING t.*;


-- name: ListQueuedClaimCandidatesByRuntimes :many
SELECT atq.* FROM agent_task_queue atq
WHERE atq.runtime_id = ANY(@runtime_ids::uuid[])
  AND atq.status = 'queued'
  AND EXISTS (
      SELECT 1
      FROM agent a
      JOIN agent_runtime r ON r.id = atq.runtime_id
      WHERE a.id = atq.agent_id
        AND a.runtime_id = atq.runtime_id
        AND (
            r.visibility = 'public'
            OR r.visibility = 'private'
        )
  )
ORDER BY atq.priority DESC, atq.created_at ASC;





-- name: NextDeferredTaskFireAtForRuntimes :one
SELECT MIN(fire_at)::timestamptz FROM agent_task_queue t WHERE t.runtime_id=ANY(@runtime_ids::uuid[]) AND t.status='deferred'
AND EXISTS(SELECT 1 FROM agent_runtime r WHERE r.id=t.runtime_id AND r.status='online' AND COALESCE(r.last_seen_at,r.updated_at)>=now()-make_interval(secs => @runtime_stale_secs::double precision));


-- name: PromoteDueDeferredTasksForRuntimes :many
UPDATE agent_task_queue t SET status='queued' WHERE t.runtime_id=ANY(@runtime_ids::uuid[]) AND t.status='deferred' AND t.fire_at<=now()
AND EXISTS(SELECT 1 FROM agent_runtime r WHERE r.id=t.runtime_id AND r.status='online' AND COALESCE(r.last_seen_at,r.updated_at)>=now()-make_interval(secs => @runtime_stale_secs::double precision)) RETURNING t.*;


-- name: GetWorkspaceAgentRunCounts :many
SELECT
    atq.agent_id,
    COUNT(*)::int AS run_count
FROM agent_task_queue atq
JOIN agent a ON a.id = atq.agent_id
WHERE a.workspace_id = $1
  AND atq.created_at > now() - INTERVAL '30 days'
GROUP BY atq.agent_id;





-- name: GetWorkspaceAgentActivity30d :many
SELECT
    atq.agent_id,
    DATE_TRUNC('day', atq.completed_at)::timestamptz AS bucket,
    COUNT(*)::int AS task_count,
    COUNT(*) FILTER (WHERE atq.status = 'failed')::int AS failed_count,
    COUNT(*) FILTER (WHERE atq.status = 'completed')::int AS completed_count,
    COUNT(*) FILTER (WHERE atq.status = 'cancelled')::int AS cancelled_count,
    COALESCE(SUM(EXTRACT(EPOCH FROM (atq.completed_at - atq.started_at)) * 1000)
        FILTER (WHERE atq.completed_at > atq.started_at), 0)::float8 AS duration_ms,
    COUNT(*) FILTER (WHERE atq.completed_at > atq.started_at)::int AS duration_count
FROM agent_task_queue atq
JOIN agent a ON a.id = atq.agent_id
WHERE a.workspace_id = $1
  AND atq.completed_at IS NOT NULL
  AND atq.completed_at > now() - INTERVAL '30 days'
GROUP BY atq.agent_id, bucket
ORDER BY atq.agent_id, bucket;





-- name: ListWorkspaceAgentTaskSnapshot :many
SELECT atq.* FROM agent_task_queue atq
JOIN agent a ON a.id = atq.agent_id
WHERE a.workspace_id = $1
  AND (atq.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory')
    OR (atq.status='deferred' AND atq.context->>'wakeup_id' IS NOT NULL))

UNION ALL

SELECT latest.* FROM agent a
JOIN LATERAL (
  SELECT atq.*
  FROM agent_task_queue atq
  WHERE atq.agent_id = a.id
    AND atq.status IN ('completed', 'failed')
  ORDER BY atq.completed_at DESC NULLS LAST, atq.created_at DESC, atq.id DESC
  LIMIT 1
) latest ON TRUE
WHERE a.workspace_id = $1;





-- name: UpdateAgentStatus :one
UPDATE agent SET status = $2, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: RefreshAgentStatusFromTasks :one
WITH desired AS (
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM agent_task_queue q
        WHERE q.agent_id = $1 AND q.status IN ('dispatched', 'running')
    ) THEN 'working' ELSE 'idle' END AS status
)
UPDATE agent AS a
SET status = desired.status,
    updated_at = now()
FROM desired
WHERE a.id = $1 AND a.status IS DISTINCT FROM desired.status
RETURNING a.*;





-- name: GetAgentBySystemKey :one
SELECT * FROM agent
WHERE workspace_id = $1 AND system_key = $2 AND archived_at IS NULL
ORDER BY created_at ASC, id ASC
LIMIT 1;





-- name: CreateSystemUserAgent :one
INSERT INTO agent (
    workspace_id, name, description, avatar_url, runtime_mode, runtime_config,
    runtime_id, model, visibility, permission_mode, max_concurrent_tasks,
    owner_id, instructions, custom_env, custom_args, kind, system_key
) VALUES (
    @workspace_id, @name, @description, @avatar_url, @runtime_mode, '{}'::jsonb,
    @runtime_id, @model, @visibility, @permission_mode, @max_concurrent_tasks,
    @owner_id, '', '{}'::jsonb, '[]'::jsonb, 'user', @system_key
)
RETURNING *;

