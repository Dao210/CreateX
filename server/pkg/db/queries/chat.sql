-- name: CreateChatSession :one
INSERT INTO chat_session (workspace_id, agent_id, creator_id, title, runtime_id, id)
VALUES ($1, $2, $3, $4, (SELECT runtime_id FROM agent WHERE id = $2), COALESCE(sqlc.narg('id')::uuid, gen_random_uuid()))
RETURNING *;





-- name: GetChatSession :one
SELECT * FROM chat_session
WHERE id = $1;





-- name: GetChatSessionInWorkspace :one
SELECT * FROM chat_session
WHERE id = $1 AND workspace_id = $2;





-- name: GetPublicChatSessionInWorkspace :one
SELECT cs.* FROM chat_session AS cs
WHERE cs.id = $1
  AND cs.workspace_id = $2
  AND (
    cs.explicitly_created_at IS NOT NULL
    OR
    EXISTS (
      SELECT 1 FROM chat_message AS public_message
      WHERE public_message.chat_session_id = cs.id
        AND public_message.message_kind != 'channel_command'
    )
  );





-- name: ListChatSessionsByCreator :many
SELECT cs.*,
       (SELECT count(*) FROM chat_message m
          WHERE m.chat_session_id = cs.id
            AND m.role = 'assistant'
            AND m.created_at > cs.last_read_at)::int AS unread_count,
       COALESCE(lm.content, '') AS last_message_content,
       COALESCE(lm.role, '') AS last_message_role,
       lm.created_at AS last_message_at,
       lm.failure_reason AS last_message_failure_reason,
       COALESCE(lm.message_kind, '') AS last_message_kind
FROM chat_session cs
LEFT JOIN LATERAL (
  SELECT content, role, created_at, failure_reason, message_kind
    FROM chat_message m
   WHERE m.chat_session_id = cs.id
     AND m.message_kind != 'channel_command'
   ORDER BY m.created_at DESC
   LIMIT 1
) lm ON true
WHERE cs.workspace_id = $1 AND cs.creator_id = $2 AND cs.status = 'active'
  AND (
    cs.explicitly_created_at IS NOT NULL
    OR
    lm.created_at IS NOT NULL
  )
ORDER BY (cs.pinned_at IS NOT NULL) DESC, cs.pinned_at DESC, COALESCE(lm.created_at, cs.updated_at) DESC;





-- name: ListAllChatSessionsByCreator :many
SELECT cs.*,
       CASE WHEN cs.status = 'archived' THEN 0
            ELSE (SELECT count(*) FROM chat_message m
                    WHERE m.chat_session_id = cs.id
                      AND m.role = 'assistant'
                      AND m.created_at > cs.last_read_at)
       END::int AS unread_count,
       COALESCE(lm.content, '') AS last_message_content,
       COALESCE(lm.role, '') AS last_message_role,
       lm.created_at AS last_message_at,
       lm.failure_reason AS last_message_failure_reason,
       COALESCE(lm.message_kind, '') AS last_message_kind
FROM chat_session cs
LEFT JOIN LATERAL (
  SELECT content, role, created_at, failure_reason, message_kind
    FROM chat_message m
   WHERE m.chat_session_id = cs.id
     AND m.message_kind != 'channel_command'
   ORDER BY m.created_at DESC
   LIMIT 1
) lm ON true
WHERE cs.workspace_id = $1 AND cs.creator_id = $2
  AND (
    cs.explicitly_created_at IS NOT NULL
    OR
    lm.created_at IS NOT NULL
  )
ORDER BY (cs.pinned_at IS NOT NULL) DESC, cs.pinned_at DESC, COALESCE(lm.created_at, cs.updated_at) DESC;





-- name: ListAgentBuilderSessionsByCreator :many
SELECT cs.id,
       cs.title,
       cs.created_at,
       cs.updated_at,
       a.runtime_id,
       COALESCE(lm.content, '') AS last_message_content,
       COALESCE(lm.role, '') AS last_message_role,
       lm.created_at AS last_message_at,
       d.draft AS stored_draft
FROM chat_session cs
JOIN agent a ON a.id = cs.agent_id
LEFT JOIN agent_builder_draft d ON d.chat_session_id = cs.id
LEFT JOIN LATERAL (
  SELECT content, role, created_at
    FROM chat_message m
   WHERE m.chat_session_id = cs.id
   ORDER BY m.created_at DESC
   LIMIT 1
) lm ON true
WHERE cs.workspace_id = $1
  AND cs.creator_id = $2
  AND cs.status = 'active'
  AND a.kind = 'system'
  AND a.system_key LIKE 'agent_builder:%'
  AND (lm.created_at IS NOT NULL OR d.chat_session_id IS NOT NULL)
ORDER BY COALESCE(lm.created_at, d.updated_at, cs.updated_at) DESC;





-- name: UpdateChatSessionTitle :one
UPDATE chat_session SET title = $2, updated_at = now()
WHERE id = $1
RETURNING *;





-- name: MarkChatSessionExplicitlyCreated :one
UPDATE chat_session
SET explicitly_created_at = COALESCE(explicitly_created_at, now())
WHERE id = $1
RETURNING *;





-- name: InitializeChatSessionTitle :one
UPDATE chat_session AS session
SET title = @title
WHERE session.id = @id
  AND session.title = ''
  AND NOT EXISTS (
    SELECT 1 FROM chat_message AS message
    WHERE message.chat_session_id = session.id
      AND message.role = 'user'
      AND message.message_kind != 'channel_command'
  )
RETURNING *;





-- name: ReplaceImplicitChatSessionTitle :one
UPDATE chat_session AS session
SET title = @title
WHERE session.id = @id
  AND session.explicitly_created_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM chat_message AS message
    WHERE message.chat_session_id = session.id
      AND message.role = 'user'
      AND message.message_kind != 'channel_command'
  )
RETURNING *;





-- name: InitializeChatSessionMediaTitle :one
UPDATE chat_session AS session
SET title = @title
WHERE session.id = @id
  AND session.title = ''
  AND EXISTS (
    SELECT 1 FROM chat_message AS message
    WHERE message.id = @message_id
      AND message.chat_session_id = session.id
      AND message.role = 'user'
      AND message.message_kind != 'channel_command'
  )
  AND NOT EXISTS (
    SELECT 1 FROM chat_message AS other_message
    WHERE other_message.chat_session_id = session.id
      AND other_message.role = 'user'
      AND other_message.message_kind != 'channel_command'
      AND other_message.id != @message_id
  )
RETURNING *;





-- name: UpdateChatSessionTitleIfCurrent :one
UPDATE chat_session SET title = @new_title, updated_at = now()
WHERE id = @id AND title = @expected_title
RETURNING *;





-- name: SetChatSessionPinned :one
UPDATE chat_session
SET pinned_at = CASE WHEN @pinned::bool THEN COALESCE(pinned_at, now()) ELSE NULL END
WHERE id = $1
RETURNING *;





-- name: SetChatSessionArchived :one
UPDATE chat_session
SET status = CASE WHEN @archived::bool THEN 'archived' ELSE 'active' END,
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: UpdateChatSessionSession :exec
UPDATE chat_session
SET session_id = COALESCE(sqlc.narg('session_id'), session_id),
    work_dir = COALESCE(sqlc.narg('work_dir'), work_dir),
    runtime_id = COALESCE(sqlc.narg('runtime_id'), runtime_id),
    updated_at = now()
WHERE id = sqlc.arg('id');





-- name: ClearChatSessionSessionIfMatches :exec
UPDATE chat_session
SET session_id = NULL,
    runtime_id = NULL,
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND session_id = sqlc.arg('session_id')
  AND runtime_id = sqlc.arg('runtime_id');





-- name: AdvanceCancelledChatSessionPointer :exec
UPDATE chat_session cs
SET session_id = t.session_id,
    runtime_id = t.runtime_id,
    work_dir   = COALESCE(t.work_dir, cs.work_dir),
    updated_at = now()
FROM agent_task_queue t
WHERE t.id = sqlc.arg('task_id')
  AND t.chat_session_id = cs.id
  AND t.status = 'cancelled'
  AND t.session_id IS NOT NULL
  AND t.runtime_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM agent_task_queue newer
      WHERE newer.chat_session_id = t.chat_session_id
        AND newer.id <> t.id
        AND newer.session_id IS NOT NULL
        AND newer.created_at > t.created_at
  );





-- name: LockChatSessionForDelete :one
SELECT id FROM chat_session
WHERE id = $1
FOR UPDATE;





-- name: LockChatSessionForAppend :one
SELECT id FROM chat_session
WHERE id = $1
FOR KEY SHARE;





-- name: LockChatSessionForRuntimeBind :one
SELECT id FROM chat_session
WHERE id = $1
FOR UPDATE;





-- name: LockChatSessionForEnqueue :one
SELECT * FROM chat_session
WHERE id = $1
FOR NO KEY UPDATE;





-- name: LockChatSessionForDraftWrite :one
SELECT * FROM chat_session
WHERE id = $1
FOR UPDATE;





-- name: DeleteChatSession :exec
DELETE FROM chat_session WHERE id = $1 AND workspace_id = $2;





-- name: TouchChatSession :exec
UPDATE chat_session SET updated_at = now()
WHERE id = $1;





-- name: CreateChatMessage :one
INSERT INTO chat_message (
    chat_session_id, role, content, task_id, failure_reason, elapsed_ms,
    message_kind, quick_actions, channel_media_pending_until, channel_ingested,
    channel_context_revision, id
)
VALUES (
    $1, $2, $3, sqlc.narg(task_id), sqlc.narg(failure_reason), sqlc.narg(elapsed_ms),
    COALESCE(sqlc.narg(message_kind)::text, 'message'),
    COALESCE(sqlc.narg(quick_actions)::jsonb, '[]'::jsonb),
    CASE WHEN sqlc.narg(channel_media_pending_secs)::float8 IS NULL THEN NULL
         ELSE now() + make_interval(secs => sqlc.narg(channel_media_pending_secs)::float8) END,
    COALESCE(sqlc.narg(channel_ingested)::boolean, FALSE),
    sqlc.narg(channel_context_revision),
    COALESCE(sqlc.narg('id')::uuid, gen_random_uuid())
)
RETURNING *;





-- name: TaskHasChannelIngestedMessages :one
SELECT EXISTS (
    SELECT 1 FROM chat_message
    WHERE task_id = $1
      AND role = 'user'
      AND channel_ingested
) AS channel_ingested;





-- name: GetTaskChannelOrigin :one
SELECT (
    task.chat_input_task_id IS NULL
    OR EXISTS (
        SELECT 1
        FROM chat_message
        WHERE task_id = task.chat_input_task_id
          AND role = 'user'
          AND channel_ingested
    )
)::boolean AS channel_ingested,
    (task.chat_input_task_id IS NULL)::boolean AS batch_owner_unknown
FROM agent_task_queue AS task
WHERE task.id = $1;





-- name: SetChatMessageChannelOutboundProvenanceByTask :execrows
UPDATE chat_message
SET channel_outbound_type = @channel_type,
    channel_outbound_installation_id = @installation_id,
    channel_outbound_chat_id = @channel_chat_id,
    channel_outbound_message_ids = @message_ids::text[]
WHERE task_id = @task_id
  AND role = 'assistant';





-- name: ListChannelOutboundMessageIDsForContext :many
SELECT external.message_id::text
FROM chat_message AS message
JOIN agent_task_queue AS owner ON owner.id = message.task_id
CROSS JOIN LATERAL unnest(message.channel_outbound_message_ids) AS external(message_id)
WHERE message.chat_session_id = @chat_session_id
  AND message.role = 'assistant'
  AND message.channel_outbound_type = @channel_type
  AND message.channel_outbound_installation_id = @installation_id
  AND message.channel_outbound_chat_id = @channel_chat_id
  AND message.channel_outbound_message_ids IS NOT NULL
  AND external.message_id = ANY(@candidate_message_ids::text[])
  AND (
      owner.channel_context_revision = @channel_context_revision
      OR (@channel_context_revision = 1 AND owner.channel_context_revision IS NULL)
  );





-- name: GetChannelMediaPendingUntil :one
SELECT channel_media_pending_until
FROM chat_message
WHERE chat_session_id = $1
  AND role = 'user'
  AND message_kind != 'channel_command'
  AND (
      sqlc.narg('channel_context_revision')::bigint IS NULL
      OR channel_context_revision = sqlc.narg('channel_context_revision')::bigint
      OR (
          sqlc.narg('channel_context_revision')::bigint = 1
          AND channel_context_revision IS NULL
      )
  )
  AND channel_media_pending_until > now()
ORDER BY channel_media_pending_until DESC
LIMIT 1;





-- name: ClearChatMessageChannelMediaPending :exec
UPDATE chat_message
SET channel_media_pending_until = NULL
WHERE id = $1 AND chat_session_id = $2;





-- name: UpdateChatMessageContentForChannelMedia :execrows
UPDATE chat_message
SET content = sqlc.arg(content)
WHERE id = sqlc.arg(id)
  AND chat_session_id = sqlc.arg(chat_session_id)
  AND role = 'user'
  AND channel_ingested;





-- name: LinkChatMessageToTask :exec
UPDATE chat_message
SET task_id = $2
WHERE id = $1 AND role = 'user';





-- name: LinkUnownedChannelChatMessagesToTask :exec
UPDATE chat_message AS message
SET task_id = @task_id
FROM agent_task_queue AS task
WHERE message.chat_session_id = @chat_session_id
  AND task.id = @task_id
  AND message.role = 'user'
  AND message.task_id IS NULL
  AND message.message_kind != 'channel_command'
  AND (
      task.channel_context_revision IS NULL
      OR message.channel_context_revision = task.channel_context_revision
      OR (
          task.channel_context_revision = 1
          AND message.channel_context_revision IS NULL
      )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM chat_message AS prior
      LEFT JOIN agent_task_queue AS prior_turn
        ON prior_turn.id = prior.task_id
      LEFT JOIN agent_task_queue AS prior_batch
        ON prior_batch.id = COALESCE(prior_turn.chat_input_task_id, prior_turn.id)
      WHERE prior.chat_session_id = @chat_session_id
        AND prior.role != 'user'
        AND (prior.created_at, prior.id) > (message.created_at, message.id)
        AND (prior_batch.id IS NULL OR prior_batch.created_at > message.created_at)
  );





-- name: ListUnownedChannelChatContextRevisions :many
WITH pending AS (
    SELECT DISTINCT COALESCE(channel_context_revision, 1)::bigint AS context_revision
    FROM chat_message
    WHERE chat_session_id = $1
      AND role = 'user'
      AND task_id IS NULL
      AND message_kind != 'channel_command'
)
SELECT pending.context_revision, generation.initiator_user_id
FROM pending
LEFT JOIN channel_chat_context_generation AS generation
  ON generation.chat_session_id = $1
 AND generation.revision = pending.context_revision
ORDER BY pending.context_revision;





-- name: DeferChatTaskForSealedPendingMedia :one
UPDATE agent_task_queue AS task
SET status = 'deferred', fire_at = pending.max_until
FROM (
    SELECT max(message.channel_media_pending_until) AS max_until
    FROM chat_message AS message
    WHERE message.task_id = @task_id
      AND message.role = 'user'
      AND message.channel_media_pending_until > now()
) AS pending
WHERE task.id = @task_id
  AND pending.max_until IS NOT NULL
  AND (task.fire_at IS NULL OR task.fire_at < pending.max_until)
RETURNING task.*;





-- name: DeleteUserChatMessageByTask :one
DELETE FROM chat_message
WHERE task_id = $1
  AND role = 'user'
  AND message_kind <> 'onboarding_kickoff'
RETURNING *;





-- name: ReleaseOnboardingKickoffFromTask :exec
UPDATE chat_message
SET task_id = (
    SELECT successor.id
    FROM agent_task_queue AS successor
    WHERE successor.chat_session_id = chat_message.chat_session_id
      AND successor.status = 'queued'
      AND successor.chat_input_task_id = successor.id
      AND successor.regenerate_quick_actions_for IS NULL
      AND successor.id <> $1
    ORDER BY successor.priority DESC, successor.created_at ASC, successor.id ASC
    LIMIT 1
)
WHERE task_id = $1
  AND role = 'user'
  AND message_kind = 'onboarding_kickoff';





-- name: ListChatMessages :many
SELECT message.* FROM chat_message AS message
WHERE message.chat_session_id = $1
  AND message.message_kind != 'channel_command'
  AND NOT (
    message.role = 'user'
    AND EXISTS (
      SELECT 1
      FROM agent_task_queue AS task
      WHERE task.chat_session_id = message.chat_session_id
        AND task.status = 'queued'
        AND task.id = message.task_id
        AND task.id <> (
          SELECT head.id
          FROM agent_task_queue AS head
          WHERE head.chat_session_id = $1
            AND head.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
            AND head.regenerate_quick_actions_for IS NULL
          ORDER BY
            CASE
              WHEN head.status IN ('dispatched', 'running', 'waiting_local_directory') THEN 0
              WHEN head.status = 'deferred' THEN 1
              ELSE 2
            END,
            head.priority DESC,
            head.created_at ASC,
            head.id ASC
          LIMIT 1
        )
    )
  )
ORDER BY message.created_at ASC, message.id ASC;





-- name: ListChatMessagesForLegacyTask :many
SELECT message.* FROM chat_message AS message
WHERE message.chat_session_id = $1
  AND NOT (
    message.role = 'user'
    AND EXISTS (
      SELECT 1
      FROM agent_task_queue AS task
      WHERE task.chat_session_id = message.chat_session_id
        AND task.status = 'queued'
        AND task.id = message.task_id
        AND task.id <> (
          SELECT head.id
          FROM agent_task_queue AS head
          WHERE head.chat_session_id = $1
            AND head.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
            AND head.regenerate_quick_actions_for IS NULL
          ORDER BY
            CASE
              WHEN head.status IN ('dispatched', 'running', 'waiting_local_directory') THEN 0
              WHEN head.status = 'deferred' THEN 1
              ELSE 2
            END,
            head.priority DESC,
            head.created_at ASC,
            head.id ASC
          LIMIT 1
        )
    )
  )
ORDER BY message.created_at ASC, message.id ASC;





-- name: ListChatInputMessages :many
SELECT * FROM chat_message
WHERE task_id = $1 AND role = 'user'
ORDER BY created_at ASC, id ASC;





-- name: ListChatMessagesPageForChannelContext :many
SELECT message.*
FROM chat_message AS message
LEFT JOIN agent_task_queue AS owner ON owner.id = message.task_id
WHERE message.chat_session_id = @chat_session_id
  AND message.message_kind != 'channel_command'
  AND (
      (
          message.role = 'user'
          AND (
              message.channel_context_revision = @channel_context_revision
              OR (@channel_context_revision = 1 AND message.channel_context_revision IS NULL)
          )
      )
      OR
      (
          message.role != 'user'
          AND (
              owner.channel_context_revision = @channel_context_revision
              OR (@channel_context_revision = 1 AND owner.channel_context_revision IS NULL)
          )
      )
  )
  AND (
    sqlc.narg('before_created_at')::timestamptz IS NULL
    OR (message.created_at, message.id) < (sqlc.narg('before_created_at')::timestamptz, sqlc.narg('before_id')::uuid)
  )
ORDER BY message.created_at DESC, message.id DESC
LIMIT @page_limit;





-- name: ReanchorClaimedDirectChatInput :exec
WITH latest_visible AS (
    SELECT
        claimed_input.id AS claimed_input_id,
        claimed_input.created_at AS input_created_at,
        prior.created_at AS prior_created_at
    FROM chat_message AS claimed_input
    CROSS JOIN LATERAL (
        SELECT prior.created_at
        FROM chat_message AS prior
        WHERE prior.chat_session_id = claimed_input.chat_session_id
          AND prior.id != claimed_input.id
          AND NOT (
            prior.role = 'user'
            AND EXISTS (
              SELECT 1
              FROM agent_task_queue AS queued_task
              WHERE queued_task.chat_session_id = prior.chat_session_id
                AND queued_task.status = 'queued'
                AND queued_task.id = prior.task_id
                AND queued_task.id <> (
                  SELECT head.id
                  FROM agent_task_queue AS head
                  WHERE head.chat_session_id = claimed_input.chat_session_id
                    AND head.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
                    AND head.regenerate_quick_actions_for IS NULL
                  ORDER BY
                    CASE
                      WHEN head.status IN ('dispatched', 'running', 'waiting_local_directory') THEN 0
                      WHEN head.status = 'deferred' THEN 1
                      ELSE 2
                    END,
                    head.priority DESC,
                    head.created_at ASC,
                    head.id ASC
                  LIMIT 1
                )
            )
          )
        ORDER BY prior.created_at DESC, prior.id DESC
        LIMIT 1
    ) AS prior
    WHERE claimed_input.task_id = @task_id
      AND claimed_input.role = 'user'
      AND NOT claimed_input.channel_ingested
      AND claimed_input.message_kind <> 'onboarding_kickoff'
)
UPDATE chat_message AS claimed_input
SET created_at = GREATEST(
    @dispatched_at::timestamptz,
    latest_visible.prior_created_at + interval '1 microsecond'
)
FROM latest_visible
WHERE claimed_input.id = latest_visible.claimed_input_id
  AND latest_visible.prior_created_at >= latest_visible.input_created_at;





-- name: ReanchorNextQueuedDirectChatInput :exec
UPDATE chat_message AS queued_input
SET created_at = sqlc.arg('assistant_created_at')::timestamptz + interval '1 microsecond'
WHERE queued_input.chat_session_id = $1
  AND queued_input.role = 'user'
  AND NOT queued_input.channel_ingested
  AND queued_input.message_kind <> 'onboarding_kickoff'
  AND queued_input.created_at <= sqlc.arg('assistant_created_at')::timestamptz
  AND EXISTS (
    SELECT 1
    FROM agent_task_queue AS queued_task
    WHERE queued_task.id = queued_input.task_id
      AND queued_task.chat_session_id = queued_input.chat_session_id
      AND queued_task.status = 'queued'
      AND queued_task.chat_input_task_id = queued_task.id
      AND queued_task.regenerate_quick_actions_for IS NULL
      AND queued_task.id = (
        SELECT head.id
        FROM agent_task_queue AS head
        WHERE head.chat_session_id = queued_input.chat_session_id
          AND head.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
          AND head.regenerate_quick_actions_for IS NULL
        ORDER BY
          CASE
            WHEN head.status IN ('dispatched', 'running', 'waiting_local_directory') THEN 0
            WHEN head.status = 'deferred' THEN 1
            ELSE 2
          END,
          head.priority DESC,
          head.created_at ASC,
          head.id ASC
        LIMIT 1
      )
  );





-- name: ListChatMessagesPage :many
SELECT message.* FROM chat_message AS message
WHERE message.chat_session_id = $1
  AND message.message_kind != 'channel_command'
  AND NOT (
    message.role = 'user'
    AND EXISTS (
      SELECT 1
      FROM agent_task_queue AS task
      WHERE task.chat_session_id = message.chat_session_id
        AND task.status = 'queued'
        AND task.id = message.task_id
        AND task.id <> (
          SELECT head.id
          FROM agent_task_queue AS head
          WHERE head.chat_session_id = $1
            AND head.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
            AND head.regenerate_quick_actions_for IS NULL
          ORDER BY
            CASE
              WHEN head.status IN ('dispatched', 'running', 'waiting_local_directory') THEN 0
              WHEN head.status = 'deferred' THEN 1
              ELSE 2
            END,
            head.priority DESC,
            head.created_at ASC,
            head.id ASC
          LIMIT 1
        )
    )
  )
  AND (
    sqlc.narg('before_created_at')::timestamptz IS NULL
    OR (message.created_at, message.id) < (sqlc.narg('before_created_at')::timestamptz, sqlc.narg('before_id')::uuid)
  )
ORDER BY message.created_at DESC, message.id DESC
LIMIT $2;





-- name: GetChatMessage :one
SELECT * FROM chat_message
WHERE id = $1;





-- name: CreateChatTask :one
INSERT INTO agent_task_queue (
    agent_id, runtime_id, status, priority, chat_session_id,
    initiator_user_id, originator_user_id, accountable_user_id, force_fresh_session, runtime_mcp_overlay,
    runtime_connected_apps, originator_source, trigger_evidence_kind, trigger_evidence_ref_id,
    fire_at, channel_context_revision, id
)
SELECT
    $1, $2,
    CASE WHEN sqlc.narg('fire_at')::timestamptz IS NULL THEN 'queued' ELSE 'deferred' END,
    $3, $4, $5,
    sqlc.narg(originator_user_id),
    sqlc.narg(accountable_user_id),
    COALESCE(sqlc.narg('force_fresh_session')::boolean, FALSE),
    sqlc.narg(runtime_mcp_overlay),
    sqlc.narg(runtime_connected_apps),
    sqlc.narg(originator_source),
    sqlc.narg(trigger_evidence_kind),
    sqlc.narg(trigger_evidence_ref_id),
    sqlc.narg('fire_at')::timestamptz,
    sqlc.narg('channel_context_revision')::bigint,
    COALESCE(sqlc.narg('id')::uuid, gen_random_uuid())
WHERE lock_task_owner_rows($1, $2)
RETURNING *;





-- name: PromoteChannelChatTasksIfMediaReady :many
UPDATE agent_task_queue AS task
SET status = 'queued', fire_at = NULL
WHERE task.chat_session_id = @chat_session_id
  AND task.status = 'deferred'
  AND task.issue_id IS NULL
  AND task.parent_task_id IS NULL
  AND task.escalation_for_task_id IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM chat_message AS message
      WHERE message.task_id = task.id
        AND message.role = 'user'
        AND message.channel_media_pending_until > now()
  )
RETURNING task.*;





-- name: SetChatTaskInputOwnerSelf :one
UPDATE agent_task_queue
SET chat_input_task_id = id
WHERE id = $1
RETURNING *;





-- name: GetLastChatTaskSession :one
WITH retired_sessions AS (
    SELECT DISTINCT r.retired_session_id AS session_id
    FROM agent_task_queue r
    WHERE r.chat_session_id = sqlc.arg('chat_session_id')
      AND (
        sqlc.narg('channel_context_revision')::bigint IS NULL
        OR COALESCE(r.channel_context_revision, 1) = sqlc.narg('channel_context_revision')::bigint
      )
      AND r.retired_session_id IS NOT NULL
), resume_overflow_at AS (
    SELECT MAX(t.completed_at) AS at
    FROM agent_task_queue t
    WHERE t.chat_session_id = sqlc.arg('chat_session_id')
      AND (
        sqlc.narg('channel_context_revision')::bigint IS NULL
        OR COALESCE(t.channel_context_revision, 1) = sqlc.narg('channel_context_revision')::bigint
      )
      AND t.status = 'failed'
      AND (
        COALESCE(t.failure_reason, '') = 'codex_resume_oversized'
        OR (COALESCE(t.error, '') ILIKE '%thread/resume failed%' AND COALESCE(t.error, '') ILIKE '%token too long%')
      )
), latest_per_session AS (
    SELECT DISTINCT ON (t.session_id)
        t.session_id, t.work_dir, t.runtime_id, t.status, t.failure_reason, t.error, t.completed_at
    FROM agent_task_queue t
    WHERE t.chat_session_id = sqlc.arg('chat_session_id')
      AND (
        sqlc.narg('channel_context_revision')::bigint IS NULL
        OR COALESCE(t.channel_context_revision, 1) = sqlc.narg('channel_context_revision')::bigint
      )
      AND t.session_id IS NOT NULL
      AND t.status IN ('completed', 'failed', 'cancelled')
    ORDER BY t.session_id, t.completed_at DESC
)
SELECT session_id, work_dir, runtime_id FROM latest_per_session
WHERE session_id NOT IN (SELECT session_id FROM retired_sessions)
  AND (
    status IN ('completed', 'cancelled')
    OR (
      status = 'failed'
      AND COALESCE(failure_reason, '') NOT IN ('iteration_limit', 'agent_fallback_message', 'api_invalid_request', 'codex_semantic_inactivity', 'agent_error.context_overflow', 'codex_resume_oversized')
      AND NOT (COALESCE(error, '') ILIKE '%400%' AND COALESCE(error, '') ILIKE '%invalid_request_error%')
      AND NOT (COALESCE(error, '') ILIKE '%could not resolve authentication method%')
      AND NOT (COALESCE(error, '') ~* 'must not be empty|must be non-?empty|must have non-?empty|non-?empty content|cannot be empty|should not be empty'
               AND COALESCE(error, '') ~* 'role[^a-z0-9]{0,2}assistant|assistant message|message at position|messages\.[0-9]|messages\[[0-9]')
    )
  )
  AND (
    (SELECT at FROM resume_overflow_at) IS NULL
    OR completed_at > (SELECT at FROM resume_overflow_at)
  )
ORDER BY completed_at DESC
LIMIT 1;





-- name: HasActiveChatTaskForSession :one
SELECT EXISTS (
  SELECT 1 FROM agent_task_queue
  WHERE chat_session_id = $1
    AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
) AS has_active;





-- name: HasPendingChatTurnForSession :one
SELECT EXISTS (
  SELECT 1 FROM agent_task_queue
  WHERE chat_session_id = $1
    AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
    AND regenerate_quick_actions_for IS NULL
) AS has_pending;





-- name: GetPendingChatTask :one
SELECT id, status, created_at FROM agent_task_queue
WHERE chat_session_id = $1 AND status IN ('queued', 'dispatched', 'running', 'waiting_local_directory')
  AND regenerate_quick_actions_for IS NULL
ORDER BY created_at DESC
LIMIT 1;





-- name: ListPendingChatTasksForSession :many
SELECT
    task.id,
    task.status,
    task.created_at,
    task.wait_reason,
    message.id AS message_id,
    COALESCE(message.content, '')::text AS content
FROM agent_task_queue AS task
LEFT JOIN LATERAL (
    SELECT input.id, input.content
    FROM chat_message AS input
    WHERE input.task_id = COALESCE(task.chat_input_task_id, task.id)
      AND input.role = 'user'
    ORDER BY input.created_at ASC, input.id ASC
    LIMIT 1
) AS message ON TRUE
WHERE task.chat_session_id = $1
  AND task.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
  AND task.regenerate_quick_actions_for IS NULL
ORDER BY
    CASE
      WHEN task.status IN ('dispatched', 'running', 'waiting_local_directory') THEN 0
      WHEN task.status = 'deferred' THEN 1
      ELSE 2
    END,
    task.priority DESC,
    task.created_at ASC,
    task.id ASC;





-- name: PrioritizeQueuedChatTask :one
WITH target AS MATERIALIZED (
  SELECT candidate.id
  FROM agent_task_queue AS candidate
  WHERE candidate.id = sqlc.arg('id')
    AND candidate.chat_session_id = sqlc.arg('chat_session_id')
    AND candidate.status = 'queued'
    AND EXISTS (
      SELECT 1
      FROM agent_task_queue AS active
      WHERE active.chat_session_id = sqlc.arg('chat_session_id')
        AND active.status IN ('dispatched', 'running', 'waiting_local_directory')
        AND active.regenerate_quick_actions_for IS NULL
    )
  FOR UPDATE
), demoted AS (
  UPDATE agent_task_queue AS queued
  SET priority = 3
  WHERE queued.chat_session_id = sqlc.arg('chat_session_id')
    AND queued.id <> sqlc.arg('id')
    AND queued.status = 'queued'
    AND queued.priority >= 4
    AND EXISTS (SELECT 1 FROM target)
), prioritized AS (
  UPDATE agent_task_queue AS selected
  SET priority = 4
  FROM target
  WHERE selected.id = target.id
  RETURNING selected.id
)
SELECT
  prioritized.id AS task_id,
  (
    SELECT active.id
    FROM agent_task_queue AS active
    WHERE active.chat_session_id = sqlc.arg('chat_session_id')
      AND active.status IN ('dispatched', 'running', 'waiting_local_directory')
      AND active.regenerate_quick_actions_for IS NULL
    ORDER BY active.created_at ASC, active.id ASC
    LIMIT 1
  )::uuid AS active_task_id
FROM prioritized;





-- name: ListPendingChatTasksByCreator :many
SELECT atq.id AS task_id, atq.status, atq.chat_session_id, cs.agent_id
FROM agent_task_queue atq
JOIN chat_session cs ON cs.id = atq.chat_session_id
WHERE atq.chat_session_id IS NOT NULL
  AND atq.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
  AND atq.regenerate_quick_actions_for IS NULL
  AND cs.workspace_id = $1
  AND cs.creator_id = $2
ORDER BY atq.created_at DESC;





-- name: HasPendingChatTasksByCreator :one
SELECT EXISTS (
  SELECT 1
  FROM agent_task_queue atq
  JOIN chat_session cs ON cs.id = atq.chat_session_id
  WHERE atq.chat_session_id IS NOT NULL
    AND atq.status IN ('queued', 'dispatched', 'running', 'waiting_local_directory', 'deferred')
    AND atq.regenerate_quick_actions_for IS NULL
    AND cs.workspace_id = sqlc.arg(workspace_id)
    AND cs.creator_id = sqlc.arg(creator_id)
    AND cs.agent_id = ANY(sqlc.arg(agent_ids)::uuid[])
) AS has_pending;





-- name: MarkChatSessionRead :exec
UPDATE chat_session SET last_read_at = now()
WHERE id = $1;





-- name: ChatSessionHasUserMessage :one
SELECT EXISTS (
    SELECT 1 FROM chat_message
    WHERE chat_session_id = $1 AND role = 'user'
) AS has_user_message;





-- name: ChatSessionHasPublicUserMessage :one
SELECT EXISTS (
    SELECT 1 FROM chat_message
    WHERE chat_session_id = $1
      AND role = 'user'
      AND message_kind != 'channel_command'
) AS has_public_user_message;





-- name: CreateChatDraftRestore :one
INSERT INTO chat_draft_restore (id, chat_session_id, task_id, content, attachment_ids)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;





-- name: ListChatDraftRestoresBySession :many
SELECT * FROM chat_draft_restore
WHERE chat_session_id = $1
ORDER BY created_at ASC;





-- name: DeleteChatDraftRestore :execrows
DELETE FROM chat_draft_restore
WHERE id = $1 AND chat_session_id = $2;





-- name: DeleteChatDraftRestoresBySession :exec
DELETE FROM chat_draft_restore
WHERE chat_session_id = $1;






-- name: LockChatSessionForTask :one
SELECT cs.id
FROM agent_task_queue t
JOIN chat_session cs ON cs.id = t.chat_session_id
WHERE t.id = $1
FOR UPDATE OF cs;





-- name: LockChatSessionsByWorkspace :many
SELECT id FROM chat_session
WHERE workspace_id = $1
ORDER BY id
FOR UPDATE;





-- name: LockChatSessionsBySystemRuntimeAgents :many
SELECT cs.id FROM chat_session cs
JOIN agent a ON a.id = cs.agent_id
WHERE a.runtime_id = $1 AND a.kind = 'system'
ORDER BY cs.id
FOR UPDATE OF cs;





-- name: DeleteChatDraftRestoresBySystemRuntimeAgents :exec
DELETE FROM chat_draft_restore
WHERE chat_session_id IN (
    SELECT cs.id FROM chat_session cs
    JOIN agent a ON a.id = cs.agent_id
    WHERE a.runtime_id = $1 AND a.kind = 'system'
);





-- name: GetChatMessageByTaskAssistant :one
SELECT * FROM chat_message
WHERE task_id = $1 AND role = 'assistant'
ORDER BY created_at DESC
LIMIT 1;





-- name: TaskInputIsOnboardingKickoffOnly :one
SELECT
    EXISTS (
        SELECT 1 FROM chat_message AS kickoff
        WHERE kickoff.task_id = sqlc.arg(task_id)
          AND kickoff.role = 'user'
          AND kickoff.message_kind = 'onboarding_kickoff'
    )
    AND NOT EXISTS (
        SELECT 1 FROM chat_message AS typed
        WHERE typed.task_id = sqlc.arg(task_id)
          AND typed.role = 'user'
          AND typed.message_kind <> 'onboarding_kickoff'
    ) AS kickoff_only;





-- name: CreateMikaOnboardingOpening :one
INSERT INTO chat_message (chat_session_id, role, content, message_kind, created_at, id)
VALUES (
    sqlc.arg(chat_session_id),
    'assistant',
    sqlc.arg(content),
    'onboarding_opening',
    sqlc.arg(kickoff_created_at)::timestamptz + interval '1 microsecond',
    COALESCE(sqlc.narg('id')::uuid, gen_random_uuid())
)
RETURNING *;





-- name: AdoptOrphanOnboardingKickoff :exec
UPDATE chat_message
SET task_id = $2
WHERE chat_session_id = $1
  AND role = 'user'
  AND message_kind = 'onboarding_kickoff'
  AND task_id IS NULL;





-- name: GetLatestAssistantChatMessageForSession :one
SELECT * FROM chat_message
WHERE chat_session_id = $1 AND role = 'assistant' AND task_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 1;





-- name: SetChatMessageQuickActionsByTask :one
UPDATE chat_message
SET quick_actions = $2
WHERE id = (
    SELECT inner_msg.id FROM chat_message AS inner_msg
    WHERE inner_msg.task_id = $1 AND inner_msg.role = 'assistant'
    ORDER BY inner_msg.created_at DESC
    LIMIT 1
)
RETURNING *;





-- name: GetOldestActiveChatSessionForCreatorAgent :one
SELECT * FROM chat_session
WHERE workspace_id = $1
  AND creator_id = $2
  AND agent_id = $3
  AND status = 'active'
ORDER BY created_at ASC
LIMIT 1;
