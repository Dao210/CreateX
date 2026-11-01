-- name: SetWorkspaceTeardownMode :exec
SELECT set_config('auro.workspace_teardown', 'on', true);





-- name: LockTaskUsageRollupForWorkspaceDelete :exec
SELECT pg_advisory_xact_lock(4246);





-- name: LockWorkspaceTaskOwnerAgents :exec
SELECT 1 FROM agent WHERE agent.workspace_id = $1 FOR UPDATE;





-- name: LockWorkspaceTaskOwnerRuntimes :exec
SELECT 1 FROM agent_runtime WHERE agent_runtime.workspace_id = $1 FOR UPDATE;





-- name: ListWorkspaceAgentIDFirstPage :many
SELECT id FROM agent
WHERE agent.workspace_id = $1
ORDER BY id
LIMIT $2;





-- name: ListWorkspaceAgentIDPage :many
SELECT id FROM agent
WHERE agent.workspace_id = $1 AND id > $2
ORDER BY id
LIMIT $3;





-- name: ListWorkspaceRuntimeIDFirstPage :many
SELECT id FROM agent_runtime
WHERE agent_runtime.workspace_id = $1
ORDER BY id
LIMIT $2;





-- name: ListWorkspaceRuntimeIDPage :many
SELECT id FROM agent_runtime
WHERE agent_runtime.workspace_id = $1 AND id > $2
ORDER BY id
LIMIT $3;





-- name: ListTaskIDsByAgentFirstPage :many
SELECT id FROM agent_task_queue
WHERE agent_id = $1
ORDER BY id
LIMIT $2
FOR UPDATE;





-- name: ListTaskIDsByAgentPage :many
SELECT id FROM agent_task_queue
WHERE agent_id = $1 AND id > $2
ORDER BY id
LIMIT $3
FOR UPDATE;





-- name: ListTaskIDsByRuntimeFirstPage :many
SELECT id FROM agent_task_queue
WHERE runtime_id = $1
ORDER BY id
LIMIT $2
FOR UPDATE;





-- name: ListTaskIDsByRuntimePage :many
SELECT id FROM agent_task_queue
WHERE runtime_id = $1 AND id > $2
ORDER BY id
LIMIT $3
FOR UPDATE;





-- name: DetachTaskBatchReferences :exec
WITH detached_runs AS (
    UPDATE autopilot_run
    SET task_id = NULL
    WHERE task_id = ANY(@task_ids::uuid[])
)
UPDATE agent_task_queue
SET parent_task_id = NULL
WHERE parent_task_id = ANY(@task_ids::uuid[]);

-- name: DeleteTaskBatch :exec
WITH batch AS MATERIALIZED (
    SELECT id FROM unnest(@task_ids::uuid[]) AS t(id)
),

deleted_task_usage AS (
    DELETE FROM task_usage WHERE task_id IN (SELECT id FROM batch)
),

deleted_task_messages AS (
    DELETE FROM task_message WHERE task_id IN (SELECT id FROM batch)
),

deleted_task_tokens AS (
    DELETE FROM task_token WHERE task_id IN (SELECT id FROM batch)
),

deleted_channel_outbound_cards AS (
    DELETE FROM channel_outbound_card_message WHERE task_id IN (SELECT id FROM batch)
),

deleted_lark_outbound_cards AS (
    DELETE FROM lark_outbound_card_message WHERE task_id IN (SELECT id FROM batch)
),

deleted_channel_task_deliveries AS (
    DELETE FROM channel_task_delivery WHERE task_id IN (SELECT id FROM batch)
),

deleted_draft_restores AS (
    DELETE FROM chat_draft_restore WHERE task_id IN (SELECT id FROM batch)
)
DELETE FROM agent_task_queue WHERE id IN (SELECT id FROM batch);

-- name: DeleteTaskTokensByAgent :exec
DELETE FROM task_token WHERE agent_id = $1;





-- name: PrepareWorkspaceDeletionLinks :exec
UPDATE webhook_delivery SET replayed_from_delivery_id=NULL WHERE workspace_id=$1 AND replayed_from_delivery_id IS NOT NULL;


-- name: DeleteWorkspaceLeafData :exec
WITH ws_agents AS MATERIALIZED (
    SELECT id FROM agent WHERE workspace_id = $1
),

ws_labels AS MATERIALIZED (
    SELECT id FROM label WHERE workspace_id = $1
),

ws_skills AS MATERIALIZED (
    SELECT id FROM skill WHERE workspace_id = $1
),

ws_sessions AS MATERIALIZED (
    SELECT id FROM chat_session WHERE workspace_id = $1
),

ws_autopilots AS MATERIALIZED (
    SELECT id FROM autopilot WHERE workspace_id = $1
),

ws_vcs_connections AS MATERIALIZED (
    SELECT id FROM vcs_connection WHERE workspace_id = $1
),

ws_channel_installations AS MATERIALIZED (
    SELECT id FROM channel_installation WHERE workspace_id = $1
),

ws_lark_installations AS MATERIALIZED (
    SELECT id FROM lark_installation WHERE workspace_id = $1
),

deleted_task_tokens AS (
    DELETE FROM task_token
    WHERE workspace_id = $1
),

deleted_hourly_dirty AS (
    DELETE FROM task_usage_hourly_dirty WHERE workspace_id = $1
),

deleted_hourly AS (
    DELETE FROM task_usage_hourly WHERE workspace_id = $1
),

deleted_attachments AS (
    DELETE FROM attachment WHERE workspace_id = $1
),

deleted_channel_outbound_cards AS (
    DELETE FROM channel_outbound_card_message
    WHERE chat_session_id IN (SELECT id FROM ws_sessions)
),

deleted_lark_outbound_cards AS (
    DELETE FROM lark_outbound_card_message
    WHERE chat_session_id IN (SELECT id FROM ws_sessions)
),

deleted_draft_restores AS (
    DELETE FROM chat_draft_restore
    WHERE chat_session_id IN (SELECT id FROM ws_sessions)
),

deleted_agent_builder_drafts AS (
    DELETE FROM agent_builder_draft WHERE workspace_id = $1
),

deleted_activity AS (
    DELETE FROM activity_log WHERE workspace_id = $1
),

deleted_world_inbox_events AS (
    DELETE FROM world_inbox_event WHERE workspace_id = $1
),

deleted_inbox AS (
    DELETE FROM inbox_item WHERE workspace_id = $1
),

deleted_agent_labels AS (
    DELETE FROM agent_to_label
    WHERE agent_id IN (SELECT id FROM ws_agents)
       OR label_id IN (SELECT id FROM ws_labels)
),

deleted_skill_labels AS (
    DELETE FROM skill_to_label
    WHERE skill_id IN (SELECT id FROM ws_skills)
       OR label_id IN (SELECT id FROM ws_labels)
),

deleted_agent_invocation_targets AS (
    DELETE FROM agent_invocation_target
    WHERE agent_id IN (SELECT id FROM ws_agents)
),

deleted_agent_skills AS (
    DELETE FROM agent_skill
    WHERE agent_id IN (SELECT id FROM ws_agents)
       OR skill_id IN (SELECT id FROM ws_skills)
),

deleted_skill_files AS (
    DELETE FROM skill_file
    WHERE skill_id IN (SELECT id FROM ws_skills)
),

deleted_daemon_connections AS (
    DELETE FROM daemon_connection
    WHERE agent_id IN (SELECT id FROM ws_agents)
),

deleted_autopilot_collaborators AS (
    DELETE FROM autopilot_collaborator
    WHERE autopilot_id IN (SELECT id FROM ws_autopilots)
),

deleted_webhook_deliveries AS (
    DELETE FROM webhook_delivery WHERE workspace_id = $1
),

deleted_channel_task_deliveries AS (
    DELETE FROM channel_task_delivery
    WHERE installation_id IN (SELECT id FROM ws_channel_installations)
),

deleted_channel_outbound_messages AS (
    DELETE FROM channel_outbound_message
    WHERE installation_id IN (SELECT id FROM ws_channel_installations)
),

deleted_channel_reply_deliveries AS (
    DELETE FROM channel_reply_delivery
    WHERE installation_id IN (SELECT id FROM ws_channel_installations)
),

deleted_channel_chat_contexts AS (
    DELETE FROM channel_chat_context_generation
    WHERE chat_session_id IN (SELECT id FROM ws_sessions)
),

deleted_channel_chat_bindings AS (
    DELETE FROM channel_chat_session_binding
    WHERE installation_id IN (SELECT id FROM ws_channel_installations)
       OR chat_session_id IN (SELECT id FROM ws_sessions)
),

deleted_dingtalk_group_routes AS (
    DELETE FROM dingtalk_group_route WHERE workspace_id = $1
),

deleted_channel_inbound_dedup AS (
    DELETE FROM channel_inbound_message_dedup
    WHERE installation_id IN (SELECT id FROM ws_channel_installations)
),

deleted_channel_inbound_audit AS (
    DELETE FROM channel_inbound_audit
    WHERE installation_id IN (SELECT id FROM ws_channel_installations)
),

deleted_channel_user_bindings AS (
    DELETE FROM channel_user_binding WHERE workspace_id = $1
),

deleted_channel_binding_tokens AS (
    DELETE FROM channel_binding_token WHERE workspace_id = $1
),

deleted_lark_chat_bindings AS (
    DELETE FROM lark_chat_session_binding
    WHERE installation_id IN (SELECT id FROM ws_lark_installations)
       OR chat_session_id IN (SELECT id FROM ws_sessions)
),

deleted_lark_inbound_dedup AS (
    DELETE FROM lark_inbound_message_dedup
    WHERE installation_id IN (SELECT id FROM ws_lark_installations)
),

deleted_lark_inbound_audit AS (
    DELETE FROM lark_inbound_audit
    WHERE installation_id IN (SELECT id FROM ws_lark_installations)
),

deleted_lark_user_bindings AS (
    DELETE FROM lark_user_binding WHERE workspace_id = $1
),

deleted_lark_binding_tokens AS (
    DELETE FROM lark_binding_token WHERE workspace_id = $1
)
UPDATE channel_media_pending_object
SET state = CASE
        WHEN state = 'tombstoned' THEN 'tombstoned'
        ELSE 'deleting'
    END,
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = now(),
    last_error = NULL
WHERE channel_media_pending_object.workspace_id = $1;

-- name: DeleteWorkspaceChatMessages :exec
DELETE FROM chat_message
WHERE chat_session_id IN (
    SELECT id FROM chat_session WHERE chat_session.workspace_id = $1
);





-- name: DeleteWorkspaceCommunicationRoots :exec
WITH deleted_sessions AS (
    DELETE FROM chat_session WHERE chat_session.workspace_id = $1
),

deleted_dingtalk_group_presence AS (
    DELETE FROM dingtalk_group_presence WHERE workspace_id = $1
),

deleted_dingtalk_bot_identity AS (
    DELETE FROM dingtalk_bot_identity WHERE workspace_id = $1
),

deleted_channel_installations AS (
    DELETE FROM channel_installation
    WHERE channel_installation.workspace_id = $1
)
DELETE FROM lark_installation WHERE lark_installation.workspace_id = $1;

-- name: DeleteWorkspaceAutopilotRuns :exec
DELETE FROM autopilot_run
WHERE autopilot_id IN (
    SELECT id FROM autopilot WHERE autopilot.workspace_id = $1
);





-- name: DeleteWorkspaceAutopilotQuotaReservations :exec
DELETE FROM autopilot_quota_reservation
WHERE autopilot_quota_reservation.workspace_id = $1;





-- name: DeleteWorkspaceAutopilotQuotaPeriods :exec
DELETE FROM autopilot_quota_period
WHERE autopilot_quota_period.workspace_id = $1;





-- name: DeleteWorkspaceAutopilotChildren :exec
WITH deleted_triggers AS (
    DELETE FROM autopilot_trigger
    WHERE autopilot_id IN (
        SELECT id FROM autopilot WHERE autopilot.workspace_id = $1
    )
)
DELETE FROM autopilot_rule_version
WHERE autopilot_rule_version.workspace_id = $1;

-- name: DeleteWorkspaceAutopilots :exec
DELETE FROM autopilot WHERE autopilot.workspace_id = $1;





-- name: DeleteWorkspaceConnections :exec
WITH deleted_github_installations AS (
    DELETE FROM github_installation
    WHERE github_installation.workspace_id = $1
)
DELETE FROM vcs_connection WHERE vcs_connection.workspace_id = $1;

-- name: DeleteWorkspaceSquadsAndSkills :exec
DELETE FROM skill WHERE skill.workspace_id = $1;

-- name: DeleteWorkspacePluginData :exec
WITH installations AS MATERIALIZED (
    SELECT plugin_installation.id
    FROM plugin_installation
    WHERE plugin_installation.workspace_id = $1
),

deleted_storage AS (
    DELETE FROM plugin_storage
    WHERE installation_id IN (SELECT id FROM installations)
),

deleted_secrets AS (
    DELETE FROM plugin_secret
    WHERE installation_id IN (SELECT id FROM installations)
),

deleted_hook_schedules AS (
    DELETE FROM plugin_hook_schedule
    WHERE installation_id IN (SELECT id FROM installations)
),

deleted_invocations AS (
    DELETE FROM plugin_invocation
    WHERE workspace_id = $1
),

versions AS MATERIALIZED (
    SELECT plugin_package_version.id
    FROM plugin_package_version
    WHERE plugin_package_version.workspace_id = $1
),

deleted_package_files AS (
    DELETE FROM plugin_package_file
    WHERE version_id IN (SELECT id FROM versions)
),

deleted_package_versions AS (
    DELETE FROM plugin_package_version
    WHERE workspace_id = $1
),

deleted_packages AS (
    DELETE FROM plugin_package
    WHERE workspace_id = $1
)
DELETE FROM plugin_installation WHERE id IN (SELECT id FROM installations);

-- name: DeleteWorkspaceAgents :exec
DELETE FROM agent WHERE agent.workspace_id = $1;





-- name: DeleteWorkspaceRuntimesAndProjects :exec
WITH deleted_runtimes AS (
    DELETE FROM agent_runtime WHERE agent_runtime.workspace_id = $1
),

deleted_profiles AS (
    DELETE FROM runtime_profile WHERE runtime_profile.workspace_id = $1
)
SELECT 1;

-- name: DeleteWorkspaceAdministration :exec
WITH game_overrides_deleted AS (
    DELETE FROM game_world_override WHERE workspace_id = $1
),

mcp_activity_deleted AS (
    DELETE FROM mcp_activity WHERE workspace_id = $1
),

deleted_siege_sessions AS (
    DELETE FROM siege_session WHERE workspace_id = $1
),

deleted_siege_budgets AS (
    DELETE FROM siege_recognition_budget WHERE workspace_id = $1
),

deleted_game_progress AS (
    DELETE FROM game_progress WHERE workspace_id = $1
),

deleted_tank_training AS (
    DELETE FROM tank_training_run WHERE workspace_id = $1
),

deleted_tank_requests AS (
    DELETE FROM tank_request WHERE workspace_id = $1
),

deleted_tank_sessions AS (
    DELETE FROM tank_play_session WHERE workspace_id = $1
),

deleted_tank_revisions AS (
    DELETE FROM tank_character_revision WHERE workspace_id = $1
),

deleted_tank_characters AS (
    DELETE FROM tank_character WHERE workspace_id = $1
),

deleted_members AS (
    DELETE FROM member WHERE member.workspace_id = $1
),

deleted_notification_preferences AS (
    DELETE FROM notification_preference
    WHERE notification_preference.workspace_id = $1
),

deleted_daemon_tokens AS (
    DELETE FROM daemon_token WHERE daemon_token.workspace_id = $1
),

detached_feedback AS (
    UPDATE feedback
    SET workspace_id = NULL
    WHERE feedback.workspace_id = $1
),

detached_client_usage AS (
    UPDATE client_usage_daily
    SET workspace_id = NULL
    WHERE client_usage_daily.workspace_id = $1
),

deleted_share_links AS (
    DELETE FROM workspace_share_link
    WHERE workspace_share_link.workspace_id = $1
)
DELETE FROM workspace_invitation
WHERE workspace_invitation.workspace_id = $1;