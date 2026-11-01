-- name: UpsertChannelInstallation :one
INSERT INTO channel_installation (
    workspace_id, agent_id, channel_type, config, installer_user_id
) VALUES (
    $1, $2, $3, $4, $5
)
ON CONFLICT (workspace_id, agent_id, channel_type) DO UPDATE SET
    channel_type      = EXCLUDED.channel_type,
    config            = EXCLUDED.config,
    installer_user_id = EXCLUDED.installer_user_id,
    status            = 'active',
    installed_at      = now(),
    updated_at        = now()
RETURNING *;





-- name: UpsertChannelInstallationByAppID :one
INSERT INTO channel_installation (
    workspace_id, agent_id, channel_type, config, installer_user_id
) VALUES (
    $1, $2, $3, $4, $5
)
ON CONFLICT (channel_type, (config ->> 'app_id')) DO UPDATE SET
    agent_id          = EXCLUDED.agent_id,
    config            = EXCLUDED.config,
    installer_user_id = EXCLUDED.installer_user_id,
    status            = 'active',
    installed_at      = now(),
    updated_at        = now()
WHERE channel_installation.workspace_id = EXCLUDED.workspace_id
RETURNING *;





-- name: GetChannelInstallation :one
SELECT * FROM channel_installation
WHERE id = sqlc.arg('id') AND channel_type = sqlc.arg('channel_type');





-- name: GetChannelInstallationInWorkspace :one
SELECT * FROM channel_installation
WHERE id = sqlc.arg('id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND channel_type = sqlc.arg('channel_type');





-- name: GetChannelInstallationByAppID :one
SELECT * FROM channel_installation
WHERE channel_type = sqlc.arg('channel_type')
  AND config ->> 'app_id' = sqlc.arg('app_id')::text;





-- name: GetChannelInstallationOwnerByAppID :one
SELECT ci.workspace_id, ci.agent_id, a.archived_at AS agent_archived_at
FROM channel_installation ci
JOIN agent a ON a.id = ci.agent_id
WHERE ci.channel_type = sqlc.arg('channel_type')
  AND ci.config ->> 'app_id' = sqlc.arg('app_id')::text;





-- name: LockChannelInstallationAppIDSlot :exec
SELECT pg_advisory_xact_lock(
    hashtext(sqlc.arg('channel_type')::text),
    hashtext(sqlc.arg('app_id')::text)
);





-- name: GetChannelInstallationSlotOwnerByAppID :one
SELECT ci.id, ci.workspace_id, ci.agent_id, ci.status,
       a.archived_at AS agent_archived_at,
       (a.id IS NOT NULL)::boolean AS agent_exists,
       (w.id IS NOT NULL)::boolean AS workspace_exists
FROM channel_installation ci
LEFT JOIN agent a ON a.id = ci.agent_id
LEFT JOIN workspace w ON w.id = ci.workspace_id
WHERE ci.channel_type = sqlc.arg('channel_type')
  AND ci.config ->> 'app_id' = sqlc.arg('app_id')::text;





-- name: ReclaimDeadChannelInstallationByAppID :one
WITH dead AS (
    DELETE FROM channel_installation ci
    WHERE ci.channel_type = sqlc.arg('channel_type')
      AND ci.config ->> 'app_id' = sqlc.arg('app_id')::text
      AND (
            (ci.status = 'revoked'
                AND NOT (ci.workspace_id = sqlc.arg('workspace_id')
                         AND ci.agent_id = sqlc.arg('agent_id')))
         OR NOT EXISTS (SELECT 1 FROM workspace w WHERE w.id = ci.workspace_id)
         OR NOT EXISTS (SELECT 1 FROM agent a WHERE a.id = ci.agent_id)
      )
    RETURNING ci.id
),
cleared_dingtalk_group_presence AS (
    DELETE FROM dingtalk_group_presence WHERE installation_id IN (SELECT id FROM dead)
),
cleared_dingtalk_bot_identity AS (
    DELETE FROM dingtalk_bot_identity WHERE installation_id IN (SELECT id FROM dead)
),
cleared_dingtalk_group_routes AS (
    DELETE FROM dingtalk_group_route WHERE installation_id IN (SELECT id FROM dead)
),
cleared_task_deliveries AS (
    DELETE FROM channel_task_delivery WHERE installation_id IN (SELECT id FROM dead)
),
cleared_outbound_messages AS (
    DELETE FROM channel_outbound_message WHERE installation_id IN (SELECT id FROM dead)
),
cleared_reply_deliveries AS (
    DELETE FROM channel_reply_delivery WHERE installation_id IN (SELECT id FROM dead)
),
cleared_chat_sessions AS (
    DELETE FROM channel_chat_session_binding
    WHERE installation_id IN (SELECT id FROM dead)
    RETURNING chat_session_id
),
cleared_chat_contexts AS (
    DELETE FROM channel_chat_context_generation AS generation
    WHERE generation.chat_session_id IN (SELECT chat_session_id FROM cleared_chat_sessions)
      AND NOT EXISTS (
          SELECT 1 FROM chat_session AS session
          WHERE session.id = generation.chat_session_id
      )
),
cleared_outbound_cards AS (
    DELETE FROM channel_outbound_card_message
    WHERE chat_session_id IN (SELECT chat_session_id FROM cleared_chat_sessions)
),
cleared_binding_tokens AS (
    DELETE FROM channel_binding_token
    WHERE installation_id IN (SELECT id FROM dead)
),
cleared_user_bindings AS (
    DELETE FROM channel_user_binding
    WHERE installation_id IN (SELECT id FROM dead)
),
cleared_inbound_dedup AS (
    DELETE FROM channel_inbound_message_dedup
    WHERE installation_id IN (SELECT id FROM dead)
),
detached_audit AS (
    UPDATE channel_inbound_audit SET installation_id = NULL
    WHERE installation_id IN (SELECT id FROM dead)
)
SELECT id FROM dead;





-- name: ClearChannelInstallationBotScopedRows :one
WITH cleared_chat_sessions AS (
    DELETE FROM channel_chat_session_binding AS binding
    WHERE binding.installation_id = @installation_id
    RETURNING binding.chat_session_id
),
cleared_outbound_cards AS (
    DELETE FROM channel_outbound_card_message AS card
    WHERE card.chat_session_id IN (SELECT chat_session_id FROM cleared_chat_sessions)
    RETURNING card.id
),
cleared_task_deliveries AS (
    DELETE FROM channel_task_delivery AS delivery
    WHERE delivery.installation_id = @installation_id
    RETURNING delivery.task_id
),
cleared_outbound_messages AS (
    DELETE FROM channel_outbound_message AS outbound
    WHERE outbound.installation_id = @installation_id
    RETURNING outbound.channel_message_id
),
cleared_binding_tokens AS (
    DELETE FROM channel_binding_token AS token
    WHERE token.installation_id = @installation_id
    RETURNING token.token_hash
),
cleared_inbound_dedup AS (
    DELETE FROM channel_inbound_message_dedup AS dedup
    WHERE dedup.installation_id = @installation_id
    RETURNING dedup.message_id
),
cleared_user_bindings AS (
    DELETE FROM channel_user_binding AS user_binding
    WHERE user_binding.installation_id = @installation_id
    RETURNING user_binding.id
)
SELECT
    (SELECT count(*) FROM cleared_user_bindings)::bigint AS user_bindings,
    (SELECT count(*) FROM cleared_chat_sessions)::bigint AS chat_session_bindings,
    (SELECT count(*) FROM cleared_task_deliveries)::bigint AS task_deliveries,
    (SELECT count(*) FROM cleared_outbound_messages)::bigint AS outbound_messages;





-- name: DeleteChannelInstallationsBySystemRuntimeAgents :exec
WITH system_agents AS (
    SELECT system_agent.id FROM agent AS system_agent
    WHERE system_agent.runtime_id = sqlc.arg('runtime_id') AND system_agent.kind = 'system'
),
doomed_sessions AS (
    SELECT id FROM chat_session
    WHERE agent_id IN (SELECT id FROM system_agents)
),
doomed AS (
    SELECT id FROM channel_installation
    WHERE agent_id IN (SELECT id FROM system_agents)
),
cleared_dingtalk_group_presence AS (
    DELETE FROM dingtalk_group_presence WHERE installation_id IN (SELECT id FROM doomed)
),
cleared_dingtalk_bot_identity AS (
    DELETE FROM dingtalk_bot_identity WHERE installation_id IN (SELECT id FROM doomed)
),
cleared_dingtalk_group_routes AS (
    DELETE FROM dingtalk_group_route WHERE installation_id IN (SELECT id FROM doomed)
),
cleared_reply_deliveries AS (
    DELETE FROM channel_reply_delivery WHERE installation_id IN (SELECT id FROM doomed)
),
cleared_task_deliveries AS (
    DELETE FROM channel_task_delivery WHERE installation_id IN (SELECT id FROM doomed)
),
cleared_outbound_messages AS (
    DELETE FROM channel_outbound_message WHERE installation_id IN (SELECT id FROM doomed)
),
cleared_chat_sessions AS (
    DELETE FROM channel_chat_session_binding WHERE installation_id IN (SELECT id FROM doomed)
    RETURNING chat_session_id
),
cleared_chat_contexts AS (
    DELETE FROM channel_chat_context_generation
    WHERE chat_session_id IN (SELECT chat_session_id FROM cleared_chat_sessions)
       OR chat_session_id IN (SELECT id FROM doomed_sessions)
),
cleared_outbound_cards AS (
    DELETE FROM channel_outbound_card_message
    WHERE chat_session_id IN (SELECT chat_session_id FROM cleared_chat_sessions)
),
cleared_binding_tokens AS (
    DELETE FROM channel_binding_token WHERE installation_id IN (SELECT id FROM doomed)
),
cleared_user_bindings AS (
    DELETE FROM channel_user_binding WHERE installation_id IN (SELECT id FROM doomed)
),
cleared_inbound_dedup AS (
    DELETE FROM channel_inbound_message_dedup WHERE installation_id IN (SELECT id FROM doomed)
),
cleared_audit AS (
    DELETE FROM channel_inbound_audit WHERE installation_id IN (SELECT id FROM doomed)
)
DELETE FROM channel_installation WHERE id IN (SELECT id FROM doomed);





-- name: ListChannelInstallationsByWorkspace :many
SELECT * FROM channel_installation
WHERE workspace_id = sqlc.arg('workspace_id')
  AND channel_type = sqlc.arg('channel_type')
ORDER BY created_at ASC;





-- name: ListActiveChannelInstallations :many
SELECT ci.* FROM channel_installation ci
JOIN workspace w ON w.id = ci.workspace_id
JOIN agent a ON a.id = ci.agent_id
WHERE ci.status = 'active'
  AND ci.channel_type = sqlc.arg('channel_type')
ORDER BY ci.created_at ASC;





-- name: ListAllActiveChannelInstallations :many
SELECT ci.* FROM channel_installation ci
JOIN workspace w ON w.id = ci.workspace_id
JOIN agent a ON a.id = ci.agent_id
WHERE ci.status = 'active'
ORDER BY ci.created_at ASC;





-- name: SetChannelInstallationStatus :exec
UPDATE channel_installation
SET status = $2, updated_at = now()
WHERE id = $1;





-- name: SetChannelInstallationConfig :exec
UPDATE channel_installation
SET config = $2, updated_at = now()
WHERE id = $1;





-- name: BackfillChannelInstallationRegionToFeishuLark :execrows
UPDATE channel_installation
SET config     = jsonb_set(config, '{region}', '"lark"'),
    updated_at = now()
WHERE channel_type = 'feishu'
  AND config ->> 'region' = 'feishu';





-- name: AcquireChannelWSLease :one
UPDATE channel_installation
SET ws_lease_token       = sqlc.arg('new_token'),
    ws_lease_expires_at  = sqlc.arg('new_expires_at'),
    updated_at           = now()
WHERE id = sqlc.arg('id')
  AND status = 'active'
  AND (
        ws_lease_token IS NULL
        OR ws_lease_expires_at < now()
        OR ws_lease_token = sqlc.arg('new_token')
  )
RETURNING *;





-- name: ReleaseChannelWSLease :exec
UPDATE channel_installation
SET ws_lease_token      = NULL,
    ws_lease_expires_at = NULL,
    updated_at          = now()
WHERE id = $1
  AND ws_lease_token = sqlc.arg('current_token');






-- name: CreateChannelUserBinding :one
INSERT INTO channel_user_binding (
    workspace_id, auro_user_id, installation_id,
    channel_type, channel_user_id, config
) VALUES (
    $1, $2, $3, $4, $5, $6
)
ON CONFLICT (installation_id, channel_user_id) DO UPDATE SET
    config   = channel_user_binding.config || jsonb_strip_nulls(EXCLUDED.config),
    bound_at = now()
WHERE channel_user_binding.auro_user_id = EXCLUDED.auro_user_id
RETURNING *;





-- name: GetChannelUserBindingByUserID :one
SELECT * FROM channel_user_binding
WHERE installation_id = $1 AND channel_user_id = $2;





-- name: FindChannelBindingForMember :one
SELECT b.* FROM channel_user_binding b
JOIN channel_installation ci ON ci.id = b.installation_id
WHERE b.workspace_id = sqlc.arg('workspace_id')
  AND b.auro_user_id = sqlc.arg('auro_user_id')
  AND b.channel_type = sqlc.arg('channel_type')
  AND ci.status = 'active'
ORDER BY b.bound_at DESC
LIMIT 1;





-- name: FindReusableChannelUserBinding :one
SELECT b.* FROM channel_user_binding b
JOIN channel_installation ci ON ci.id = b.installation_id
WHERE b.workspace_id = sqlc.arg('workspace_id')
  AND b.channel_type = sqlc.arg('channel_type')
  AND b.channel_user_id = sqlc.arg('channel_user_id')
  AND ci.config ->> 'team_id' = sqlc.arg('team_id')::text
ORDER BY b.bound_at DESC
LIMIT 1;





-- name: DeleteChannelUserBindingsByWorkspaceMember :exec
DELETE FROM channel_user_binding
WHERE workspace_id = $1 AND auro_user_id = $2;





-- name: DeleteChannelUserBindingsByInstallation :exec
DELETE FROM channel_user_binding
WHERE installation_id = $1;






-- name: CreateChannelChatSessionBinding :one
WITH next_route AS (
    SELECT COALESCE(MAX(route_revision) + 1, 1)::bigint AS route_revision
    FROM channel_chat_session_binding AS existing
    WHERE existing.installation_id = $2 AND existing.channel_chat_id = $4
), binding AS (
INSERT INTO channel_chat_session_binding (
    chat_session_id, installation_id, channel_type, channel_chat_id, chat_type,
    config, route_revision
)
SELECT $1, $2, $3, $4, $5, $6, next_route.route_revision
FROM next_route
RETURNING *
), generation AS (
    INSERT INTO channel_chat_context_generation (chat_session_id, revision)
    SELECT chat_session_id, context_revision FROM binding
)
SELECT * FROM binding;





-- name: CreateChannelChatSessionBindingGeneration :one
WITH next_route AS (
    SELECT GREATEST(
        @route_revision::bigint,
        COALESCE(MAX(route_revision) + 1, 1)::bigint
    ) AS route_revision
    FROM channel_chat_session_binding AS existing
    WHERE existing.installation_id = @installation_id
      AND existing.channel_chat_id = @channel_chat_id
), binding AS (
INSERT INTO channel_chat_session_binding (
    chat_session_id, installation_id, channel_type, channel_chat_id, chat_type,
    config, route_revision, history_start_message_id, history_boundary_pending
) SELECT
    @chat_session_id, @installation_id, @channel_type, @channel_chat_id, @chat_type,
    @config, next_route.route_revision, sqlc.narg('history_start_message_id'), @history_boundary_pending
FROM next_route
RETURNING *
), generation AS (
    INSERT INTO channel_chat_context_generation (
        chat_session_id, revision, history_start_message_id, history_boundary_pending
    )
    SELECT chat_session_id, context_revision, history_start_message_id, history_boundary_pending
    FROM binding
)
SELECT * FROM binding;





-- name: GetChannelChatSessionBinding :one
SELECT * FROM channel_chat_session_binding
WHERE installation_id = $1 AND channel_chat_id = $2 AND retired_at IS NULL;





-- name: LockCurrentChannelChatSessionBinding :one
SELECT * FROM channel_chat_session_binding
WHERE installation_id = $1 AND channel_chat_id = $2 AND retired_at IS NULL
FOR UPDATE;





-- name: LockCurrentChannelChatSessionBindingBySession :one
SELECT * FROM channel_chat_session_binding
WHERE chat_session_id = $1 AND retired_at IS NULL
FOR UPDATE;





-- name: RetireChannelChatSessionBinding :one
UPDATE channel_chat_session_binding
SET retired_at = now(),
    history_end_message_id = sqlc.narg('history_end_message_id')
WHERE id = @id AND retired_at IS NULL
RETURNING *;





-- name: GetChannelChatSessionBindingBySession :one
SELECT * FROM channel_chat_session_binding
WHERE chat_session_id = sqlc.arg('chat_session_id')
  AND channel_type = sqlc.arg('channel_type');





-- name: GetChannelChatSessionBindingBySessionAny :one
SELECT * FROM channel_chat_session_binding
WHERE chat_session_id = $1;





-- name: ListChannelChatSessionBindingsBySessions :many
SELECT * FROM channel_chat_session_binding
WHERE chat_session_id = ANY(@chat_session_ids::uuid[]);





-- name: UpdateChannelChatSessionBindingReplyTarget :exec
WITH current_route AS (
    SELECT current_binding.*
    FROM channel_chat_session_binding AS current_binding
    WHERE current_binding.chat_session_id = sqlc.arg('reply_chat_session_id')
    FOR UPDATE OF current_binding
), closed_previous AS (
    UPDATE channel_chat_session_binding AS previous
    SET history_end_message_id = sqlc.narg('last_message_id')
    FROM current_route AS current
    WHERE current.history_boundary_pending
      AND sqlc.narg('last_message_id')::text IS NOT NULL
      AND previous.installation_id = current.installation_id
      AND previous.channel_chat_id = current.channel_chat_id
      AND previous.route_revision < current.route_revision
      AND previous.retired_at IS NOT NULL
      AND previous.history_end_message_id IS NULL
)
UPDATE channel_chat_session_binding AS binding
SET last_message_id = sqlc.narg('last_message_id'),
    last_thread_id  = sqlc.narg('last_thread_id'),
    history_start_message_id = CASE
        WHEN binding.history_boundary_pending
          AND sqlc.narg('last_message_id')::text IS NOT NULL
        THEN sqlc.narg('last_message_id')
        ELSE binding.history_start_message_id
    END,
    history_boundary_pending = CASE
        WHEN sqlc.narg('last_message_id')::text IS NOT NULL THEN FALSE
        ELSE binding.history_boundary_pending
    END
FROM current_route
WHERE binding.id = current_route.id;





-- name: MarkChannelChatSessionPendingFresh :one
UPDATE channel_chat_session_binding
SET pending_fresh = TRUE
WHERE chat_session_id = $1 AND retired_at IS NULL
RETURNING pending_fresh;





-- name: LockChannelChatSessionPendingFresh :one
SELECT pending_fresh FROM channel_chat_session_binding
WHERE chat_session_id = $1
FOR UPDATE;





-- name: LockChannelChatSessionBindingForContext :one
SELECT * FROM channel_chat_session_binding
WHERE chat_session_id = $1
FOR UPDATE;





-- name: ClearChannelChatSessionPendingFresh :exec
UPDATE channel_chat_session_binding
SET pending_fresh = FALSE
WHERE chat_session_id = $1;





-- name: ClearChannelChatSessionPendingFreshForRevision :exec
UPDATE channel_chat_session_binding
SET pending_fresh = FALSE
WHERE chat_session_id = @chat_session_id
  AND context_revision = @revision;





-- name: AdvanceChannelChatContextGeneration :one
WITH closed AS (
    UPDATE channel_chat_context_generation AS generation
    SET history_end_message_id = sqlc.narg('history_boundary_message_id')
    WHERE generation.chat_session_id = @chat_session_id
      AND generation.revision = @current_revision
), advanced AS (
    UPDATE channel_chat_session_binding AS binding
    SET context_revision = binding.context_revision + 1,
        pending_fresh = TRUE
    WHERE binding.chat_session_id = @chat_session_id
      AND binding.context_revision = @current_revision
    RETURNING binding.*
), opened AS (
    INSERT INTO channel_chat_context_generation (
        chat_session_id, revision, history_start_message_id,
        history_boundary_pending, pending_fresh
    )
    SELECT chat_session_id, context_revision,
           CASE WHEN @has_message_body::boolean THEN sqlc.narg('history_boundary_message_id') END,
           NOT @has_message_body::boolean,
           TRUE
    FROM advanced
    RETURNING *
)
SELECT * FROM opened;





-- name: LockChannelChatContextGenerationByRevision :one
SELECT * FROM channel_chat_context_generation
WHERE chat_session_id = @chat_session_id
  AND revision = @revision
FOR UPDATE;





-- name: ResolveChannelChatContextHistoryStart :exec
UPDATE channel_chat_context_generation
SET history_start_message_id = @history_start_message_id,
    history_boundary_pending = FALSE
WHERE chat_session_id = @chat_session_id
  AND revision = @revision
  AND history_boundary_pending;





-- name: SetChannelChatContextInitiator :one
UPDATE channel_chat_context_generation
SET initiator_user_id = @initiator_user_id
WHERE chat_session_id = @chat_session_id
  AND revision = @revision
RETURNING initiator_user_id;





-- name: SetChannelChatContextReplyTarget :exec
UPDATE channel_chat_context_generation
SET last_message_id = sqlc.narg('last_message_id'),
    last_thread_id  = sqlc.narg('last_thread_id'),
    last_sender_id  = sqlc.narg('last_sender_id')
WHERE chat_session_id = @chat_session_id
  AND revision = @revision;





-- name: ClearChannelChatContextPendingFresh :exec
UPDATE channel_chat_context_generation
SET pending_fresh = FALSE
WHERE chat_session_id = @chat_session_id
  AND revision = @revision;





-- name: GetChannelChatContextGeneration :one
SELECT * FROM channel_chat_context_generation
WHERE chat_session_id = @chat_session_id
  AND revision = @revision;





-- name: DeleteChannelChatSessionBindingBySession :exec
WITH target AS (
    SELECT binding.id FROM channel_chat_session_binding AS binding
    WHERE binding.chat_session_id = sqlc.arg('chat_session_id')
), cleared_deliveries AS (
    DELETE FROM channel_task_delivery AS delivery WHERE delivery.binding_id IN (SELECT id FROM target)
), cleared_outbound AS (
    DELETE FROM channel_outbound_message AS outbound WHERE outbound.binding_id IN (SELECT id FROM target)
), cleared_reply_deliveries AS (
    DELETE FROM channel_reply_delivery AS reply WHERE reply.binding_id IN (SELECT id FROM target)
), deleted_binding AS (
    DELETE FROM channel_chat_session_binding AS binding WHERE binding.id IN (SELECT id FROM target)
)
DELETE FROM channel_chat_context_generation AS generation
WHERE generation.chat_session_id = sqlc.arg('chat_session_id');





-- name: DeleteChannelChatSessionBindingsByInstallation :exec
WITH cleared_deliveries AS (
    DELETE FROM channel_task_delivery AS delivery
    WHERE delivery.installation_id = sqlc.arg('installation_id')
      AND delivery.channel_type = sqlc.arg('channel_type')
), cleared_outbound AS (
    DELETE FROM channel_outbound_message AS outbound
    WHERE outbound.installation_id = sqlc.arg('installation_id')
      AND outbound.channel_type = sqlc.arg('channel_type')
), cleared_reply_deliveries AS (
    DELETE FROM channel_reply_delivery AS reply
    WHERE reply.installation_id = sqlc.arg('installation_id')
      AND reply.channel_type = sqlc.arg('channel_type')
)
DELETE FROM channel_chat_session_binding AS binding
WHERE binding.installation_id = sqlc.arg('installation_id')
  AND binding.channel_type = sqlc.arg('channel_type');






-- name: CreateChannelTaskDeliveryFromSession :one
INSERT INTO channel_task_delivery (
    task_id, binding_id, installation_id, channel_type, channel_chat_id, chat_type,
    channel_message_id, channel_thread_id, channel_sender_id, route_revision, config
)
SELECT
    @task_id, binding.id, binding.installation_id, binding.channel_type,
    binding.channel_chat_id, binding.chat_type,
    generation.last_message_id,
    CASE
        WHEN generation.last_message_id IS NOT NULL THEN generation.last_thread_id
        WHEN COALESCE(binding.config ->> 'chat_id', binding.config ->> 'channel_id', '')
             NOT IN ('', binding.channel_chat_id) THEN binding.last_thread_id
        ELSE NULL
    END,
    generation.last_sender_id,
    binding.route_revision, binding.config
FROM channel_chat_session_binding AS binding
JOIN channel_chat_context_generation AS generation
  ON generation.chat_session_id = binding.chat_session_id
 AND generation.revision = @context_revision
WHERE binding.chat_session_id = @chat_session_id
RETURNING *;





-- name: GetChannelTaskDelivery :one
SELECT * FROM channel_task_delivery WHERE task_id = $1;





-- name: CopyChannelTaskDelivery :exec
INSERT INTO channel_task_delivery (
    task_id, binding_id, installation_id, channel_type, channel_chat_id, chat_type,
    channel_message_id, channel_thread_id, channel_sender_id, route_revision, config
)
SELECT
    @child_task_id, delivery.binding_id, delivery.installation_id, delivery.channel_type, delivery.channel_chat_id, delivery.chat_type,
    delivery.channel_message_id, delivery.channel_thread_id, delivery.channel_sender_id, delivery.route_revision, delivery.config
FROM channel_task_delivery AS delivery
WHERE delivery.task_id = @parent_task_id;






-- name: RecordChannelOutboundMessage :exec
INSERT INTO channel_outbound_message (
    installation_id, channel_type, channel_message_id, binding_id,
    route_revision, task_id, outbound_kind
) VALUES (
    sqlc.arg('outbound_installation_id'), sqlc.arg('outbound_channel_type'),
    sqlc.arg('outbound_message_id'), sqlc.arg('outbound_binding_id'),
    sqlc.arg('outbound_route_revision'), sqlc.narg('outbound_task_id'),
    sqlc.arg('outbound_kind')
)
ON CONFLICT (installation_id, channel_message_id) DO NOTHING;





-- name: ListChannelOutboundMessageIDsForBinding :many
SELECT outbound.channel_message_id FROM channel_outbound_message AS outbound
WHERE outbound.binding_id = $1
ORDER BY outbound.created_at ASC;





-- name: ListChannelOutboundMessagesByIDs :many
SELECT outbound.* FROM channel_outbound_message AS outbound
WHERE outbound.installation_id = @installation_id
  AND outbound.channel_message_id = ANY(@channel_message_ids::text[]);






-- name: ClaimChannelInboundDedup :one
INSERT INTO channel_inbound_message_dedup (installation_id, message_id, claim_token)
VALUES ($1, $2, gen_random_uuid())
ON CONFLICT (installation_id, message_id) DO UPDATE
    SET received_at = now(),
        claim_token = gen_random_uuid()
    WHERE channel_inbound_message_dedup.processed_at IS NULL
      AND channel_inbound_message_dedup.received_at < now() - INTERVAL '60 seconds'
RETURNING installation_id, message_id, received_at, processed_at, claim_token;





-- name: MarkChannelInboundDedupProcessed :execrows
UPDATE channel_inbound_message_dedup
SET processed_at = now()
WHERE installation_id = $1
  AND message_id = $2
  AND claim_token = $3
  AND processed_at IS NULL;





-- name: ReleaseChannelInboundDedup :execrows
DELETE FROM channel_inbound_message_dedup
WHERE installation_id = $1
  AND message_id = $2
  AND claim_token = $3
  AND processed_at IS NULL;





-- name: PurgeChannelInboundDedup :exec
DELETE FROM channel_inbound_message_dedup
WHERE received_at < $1;






-- name: RecordChannelInboundDrop :exec
INSERT INTO channel_inbound_audit (
    installation_id, channel_type, channel_chat_id, event_type,
    channel_event_id, channel_message_id, drop_reason, id
) VALUES (
    sqlc.narg('installation_id'),
    $1,
    sqlc.narg('channel_chat_id'),
    $2,
    sqlc.narg('channel_event_id'),
    sqlc.narg('channel_message_id'),
    $3,
    COALESCE(sqlc.narg('id')::uuid, gen_random_uuid())
);





-- name: ListChannelInboundAuditByInstallation :many
SELECT * FROM channel_inbound_audit
WHERE installation_id = $1
ORDER BY received_at DESC
LIMIT $2 OFFSET $3;





-- name: NullChannelInboundAuditInstallationID :exec
UPDATE channel_inbound_audit
SET installation_id = NULL
WHERE installation_id = $1;






-- name: CreateChannelOutboundCardMessage :one
INSERT INTO channel_outbound_card_message (
    chat_session_id, task_id, channel_type, channel_chat_id,
    channel_card_message_id, status
) VALUES (
    $1, sqlc.narg('task_id'), $2, $3, $4, $5
)
RETURNING *;





-- name: GetChannelOutboundCardByTask :one
SELECT * FROM channel_outbound_card_message
WHERE task_id = sqlc.arg('task_id')
  AND channel_type = sqlc.arg('channel_type');





-- name: UpdateChannelOutboundCardStatus :exec
UPDATE channel_outbound_card_message
SET status = $2,
    last_patched_at = now()
WHERE id = $1;





-- name: DeleteChannelOutboundCardMessagesBySession :exec
DELETE FROM channel_outbound_card_message
WHERE chat_session_id = $1;






-- name: CreateChannelBindingToken :one
INSERT INTO channel_binding_token (
    token_hash, workspace_id, installation_id, channel_type,
    channel_user_id, expires_at
) VALUES (
    $1, $2, $3, $4, $5,
    LEAST(sqlc.arg('expires_at')::timestamptz, now() + INTERVAL '15 minutes')
)
RETURNING *;





-- name: FindLiveChannelBindingToken :one
SELECT * FROM channel_binding_token
WHERE installation_id = $1
  AND channel_type = $2
  AND channel_user_id = $3
  AND consumed_at IS NULL
  AND expires_at > now()
  AND created_at >= now() - sqlc.arg('mint_interval')::interval
ORDER BY created_at DESC
LIMIT 1;





-- name: ConsumeChannelBindingToken :one
UPDATE channel_binding_token
SET consumed_at = now()
WHERE token_hash = $1
  AND consumed_at IS NULL
  AND expires_at > now()
RETURNING *;





-- name: PurgeExpiredChannelBindingTokens :exec
DELETE FROM channel_binding_token
WHERE expires_at < $1;





-- name: DeleteChannelBindingTokensByInstallation :exec
DELETE FROM channel_binding_token
WHERE installation_id = $1;






-- name: RecordChannelMediaPendingObject :one
INSERT INTO channel_media_pending_object (
    storage_key, workspace_id, chat_message_id, storage_url, installation_id
)
VALUES ($1, $2, $3, $4, sqlc.narg(installation_id))
ON CONFLICT (storage_key) DO UPDATE
SET created_at = now(), next_attempt_at = now(),
    chat_message_id = EXCLUDED.chat_message_id,
    storage_url = EXCLUDED.storage_url
WHERE channel_media_pending_object.state = 'pending'
  AND channel_media_pending_object.workspace_id = EXCLUDED.workspace_id
RETURNING storage_key;





-- name: ClaimChannelMediaPendingObjectsForBind :many
DELETE FROM channel_media_pending_object
WHERE storage_key = ANY(@storage_keys::text[])
  AND workspace_id = @workspace_id
  AND state = 'pending'
RETURNING storage_key;





-- name: ClaimNextChannelMediaPendingObjectForReconcile :one
UPDATE channel_media_pending_object AS obj
SET state = CASE WHEN obj.state = 'tombstoned' THEN 'tombstoned' ELSE 'deleting' END,
    lease_token = @lease_token,
    lease_expires_at = now() + @lease::interval,
    attempt = obj.attempt + 1
FROM (
    SELECT cand.storage_key FROM channel_media_pending_object AS cand
    WHERE cand.next_attempt_at <= now()
      AND (
          (cand.state = 'pending' AND cand.created_at <= now() - @settle_delay::interval)
          OR (cand.state = 'deleting' AND (cand.lease_expires_at IS NULL OR cand.lease_expires_at <= now()))
          OR (cand.state = 'tombstoned' AND (cand.lease_expires_at IS NULL OR cand.lease_expires_at <= now()))
      )
    ORDER BY cand.next_attempt_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
) AS due
WHERE obj.storage_key = due.storage_key
RETURNING obj.*;





-- name: ReleaseChannelMediaPendingObject :exec
UPDATE channel_media_pending_object
SET lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = now() + @backoff::interval,
    last_error = @last_error
WHERE storage_key = @storage_key
  AND workspace_id = @workspace_id
  AND lease_token = @lease_token;





-- name: TombstoneChannelMediaPendingObject :execrows
UPDATE channel_media_pending_object
SET state = 'tombstoned',
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = now() + @redelete_delay::interval,
    tombstone_pass = @tombstone_pass,
    last_error = NULL
WHERE storage_key = @storage_key
  AND workspace_id = @workspace_id
  AND lease_token = @lease_token;





-- name: DeleteChannelMediaPendingObject :execrows
DELETE FROM channel_media_pending_object
WHERE storage_key = @storage_key
  AND workspace_id = @workspace_id
  AND lease_token = @lease_token;





-- name: ChannelMediaObjectIsReferenced :one
SELECT EXISTS (
    SELECT 1 FROM attachment
    WHERE chat_message_id = @chat_message_id
      AND workspace_id = @workspace_id
      AND url = @storage_url
) AS referenced;






-- name: GetChannelReplyTurn :one
WITH RECURSIVE chain(task_id, parent_task_id, depth) AS (
    SELECT attempt.id, attempt.retry_of_task_id, 0
    FROM agent_task_queue attempt
    WHERE attempt.id = $1
    UNION ALL
    SELECT parent.id, parent.retry_of_task_id, chain.depth + 1
    FROM agent_task_queue parent
    JOIN chain ON parent.id = chain.parent_task_id
)
SELECT
    (SELECT root.task_id FROM chain root WHERE root.parent_task_id IS NULL LIMIT 1) AS turn_id,
    (SELECT COALESCE(MAX(step.depth), 0) FROM chain step)::int AS attempt_depth;





-- name: AcquireChannelReplyDelivery :one
INSERT INTO channel_reply_delivery (
    turn_id, task_id, attempt_depth, binding_id, installation_id, channel_type, chat_id,
    phase, send_state, owner_token, owner_expires_at
) VALUES (
    @turn_id, @task_id, @attempt_depth, @binding_id, @installation_id, @channel_type, @chat_id,
    @phase, 'none', @owner_token, now() + make_interval(secs => @lease_seconds::double precision)
)
ON CONFLICT (turn_id) DO UPDATE
SET task_id = EXCLUDED.task_id,
    attempt_depth = EXCLUDED.attempt_depth,
    phase = CASE WHEN EXCLUDED.phase = 'terminal' THEN 'terminal' ELSE channel_reply_delivery.phase END,
    owner_token = EXCLUDED.owner_token,
    owner_expires_at = EXCLUDED.owner_expires_at,
    updated_at = now()
WHERE channel_reply_delivery.phase <> 'settled'
  AND (channel_reply_delivery.owner_token IS NULL OR channel_reply_delivery.owner_expires_at <= now())
  AND NOT (EXCLUDED.phase = 'streaming' AND channel_reply_delivery.phase = 'terminal')
  AND EXCLUDED.attempt_depth >= channel_reply_delivery.attempt_depth
RETURNING *;





-- name: GetChannelReplyDelivery :one
SELECT * FROM channel_reply_delivery WHERE turn_id = $1;





-- name: ReleaseChannelReplyDelivery :execrows
UPDATE channel_reply_delivery
SET owner_token = NULL, owner_expires_at = NULL, updated_at = now()
WHERE turn_id = $1 AND owner_token = $2;





-- name: RenewChannelReplyDelivery :execrows
UPDATE channel_reply_delivery
SET owner_expires_at = now() + make_interval(secs => sqlc.arg(lease_seconds)::double precision), updated_at = now()
WHERE turn_id = sqlc.arg(turn_id) AND owner_token = sqlc.arg(owner_token) AND phase <> 'settled';





-- name: MarkChannelReplyDeliverySending :execrows
UPDATE channel_reply_delivery
SET send_state = 'in_flight', updated_at = now()
WHERE turn_id = $1 AND owner_token = $2 AND send_state NOT IN ('in_flight', 'unknown');





-- name: RecordChannelReplyDeliveryPlaceholder :execrows
UPDATE channel_reply_delivery
SET send_state = 'known', message_id = $3, updated_at = now()
WHERE turn_id = $1 AND owner_token = $2 AND send_state = 'in_flight';





-- name: RecordChannelReplyDeliveryChunk :execrows
UPDATE channel_reply_delivery
SET send_state = 'known',
    message_id = CASE WHEN message_id = '' THEN sqlc.arg(message_id)::text ELSE message_id END,
    chunks_sent = GREATEST(chunks_sent, sqlc.arg(chunks_sent)::int),
    updated_at = now()
WHERE turn_id = sqlc.arg(turn_id) AND owner_token = sqlc.arg(owner_token);





-- name: ResetChannelReplyDeliverySend :execrows
UPDATE channel_reply_delivery
SET send_state = CASE WHEN message_id = '' THEN 'none' ELSE 'known' END, updated_at = now()
WHERE turn_id = $1 AND owner_token = $2 AND send_state = 'in_flight';





-- name: MarkChannelReplyDeliverySendUnknown :execrows
UPDATE channel_reply_delivery
SET send_state = 'unknown', updated_at = now()
WHERE turn_id = $1 AND send_state = 'in_flight';





-- name: SettleChannelReplyDelivery :execrows
UPDATE channel_reply_delivery
SET phase = 'settled', settled_reason = $3, owner_token = NULL, owner_expires_at = NULL, updated_at = now()
WHERE turn_id = $1 AND owner_token = $2 AND phase <> 'settled';





-- name: CloseChannelReplyDeliveryTurn :one
INSERT INTO channel_reply_delivery (
    turn_id, task_id, attempt_depth, binding_id, installation_id, channel_type, chat_id,
    phase, send_state, settled_reason
) VALUES (
    @turn_id, @task_id, @attempt_depth, @binding_id, @installation_id, @channel_type, @chat_id,
    'settled', 'none', @settled_reason
)
ON CONFLICT (turn_id) DO UPDATE
SET phase = 'settled',
    settled_reason = @settled_reason,
    owner_token = NULL,
    owner_expires_at = NULL,
    updated_at = now()
WHERE channel_reply_delivery.phase <> 'settled'
  AND (channel_reply_delivery.owner_token IS NULL OR channel_reply_delivery.owner_expires_at <= now())
  AND EXCLUDED.attempt_depth >= channel_reply_delivery.attempt_depth
RETURNING *;
