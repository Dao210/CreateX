-- Current application schema. Initialize an empty database; historical ledgers are not supported.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE TABLE activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    actor_type text,
    actor_id uuid,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT activity_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['member'::text, 'agent'::text, 'system'::text])))
);

CREATE TABLE agent (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    avatar_url text,
    runtime_mode text NOT NULL,
    runtime_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    max_concurrent_tasks integer DEFAULT 6 NOT NULL,
    owner_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    runtime_id uuid,
    instructions text DEFAULT ''::text NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    custom_env jsonb DEFAULT '{}'::jsonb NOT NULL,
    custom_args jsonb DEFAULT '[]'::jsonb NOT NULL,
    mcp_config jsonb,
    model text,
    thinking_level text,
    composio_toolkit_allowlist text[],
    permission_mode text DEFAULT 'private'::text NOT NULL,
    kind text DEFAULT 'user'::text NOT NULL,
    system_key text,
    disabled_runtime_skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    service_tier text,
    conversation_starters jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT agent_conversation_starters_check CHECK (((jsonb_typeof(conversation_starters) = 'array'::text) AND (jsonb_array_length(conversation_starters) <= 3))),
    CONSTRAINT agent_description_length CHECK ((char_length(description) <= 255)),
    CONSTRAINT agent_kind_check CHECK ((kind = ANY (ARRAY['user'::text, 'system'::text]))),
    CONSTRAINT agent_permission_mode_check CHECK ((permission_mode = ANY (ARRAY['private'::text, 'public_to'::text]))),
    CONSTRAINT agent_runtime_mode_check CHECK ((runtime_mode = ANY (ARRAY['local'::text, 'cloud'::text]))),
    CONSTRAINT agent_status_check CHECK ((status = ANY (ARRAY['idle'::text, 'working'::text, 'blocked'::text, 'error'::text, 'offline'::text]))),
    CONSTRAINT agent_visibility_check CHECK ((visibility = ANY (ARRAY['workspace'::text, 'private'::text])))
);

CREATE TABLE agent_builder_draft (
    chat_session_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    draft jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE agent_invocation_target (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_invocation_target_target_type_check CHECK ((target_type = ANY (ARRAY['workspace'::text, 'member'::text, 'team'::text])))
);

CREATE TABLE agent_mcp_server (
    agent_id uuid NOT NULL,
    server_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE agent_runtime (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    daemon_id text,
    name text NOT NULL,
    runtime_mode text NOT NULL,
    provider text NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    device_info text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_id uuid,
    legacy_daemon_id text,
    visibility text DEFAULT 'private'::text NOT NULL,
    profile_id uuid,
    custom_name text,
    CONSTRAINT agent_runtime_runtime_mode_check CHECK ((runtime_mode = ANY (ARRAY['local'::text, 'cloud'::text]))),
    CONSTRAINT agent_runtime_status_check CHECK ((status = ANY (ARRAY['online'::text, 'offline'::text]))),
    CONSTRAINT agent_runtime_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'public'::text])))
);

CREATE TABLE agent_skill (
    agent_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    enabled boolean DEFAULT true NOT NULL
);

CREATE TABLE agent_task_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    dispatched_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    result jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    context jsonb,
    runtime_id uuid,
    session_id text,
    work_dir text,
    chat_session_id uuid,
    autopilot_run_id uuid,
    attempt integer DEFAULT 1 NOT NULL,
    max_attempts integer DEFAULT 2 NOT NULL,
    parent_task_id uuid,
    failure_reason text,
    trigger_summary text,
    force_fresh_session boolean DEFAULT false NOT NULL,
    wait_reason text,
    initiator_user_id uuid,
    handoff_note text,
    prepare_lease_expires_at timestamp with time zone,
    runtime_mcp_overlay jsonb,
    fire_at timestamp with time zone,
    originator_user_id uuid,
    runtime_connected_apps jsonb,
    chat_input_task_id uuid,
    chat_finalize_deferred_at timestamp with time zone,
    originator_source text,
    delegated_from_task_id uuid,
    retry_of_task_id uuid,
    rerun_of_task_id uuid,
    rule_version_id uuid,
    trigger_evidence_kind text,
    trigger_evidence_ref_id uuid,
    accountable_user_id uuid,
    session_rollout_missing boolean DEFAULT false NOT NULL,
    retired_session_id text,
    quick_actions_disabled boolean DEFAULT false NOT NULL,
    regenerate_quick_actions_for uuid,
    branch_name text,
    durable_work_dir text,
    channel_context_revision bigint,
    cancelled_by_type text,
    cancelled_by_id uuid,
    cancelled_by_name text,
    CONSTRAINT agent_task_queue_accountable_matches_originator CHECK (((originator_user_id IS NULL) OR ((accountable_user_id IS NOT NULL) AND (accountable_user_id = originator_user_id)))),
    CONSTRAINT agent_task_queue_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'dispatched'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'waiting_local_directory'::text, 'deferred'::text])))
);

CREATE TABLE agent_to_label (
    agent_id uuid NOT NULL,
    label_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE attachment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    uploader_type text NOT NULL,
    uploader_id uuid NOT NULL,
    filename text NOT NULL,
    url text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    chat_session_id uuid,
    chat_message_id uuid,
    task_id uuid,
    CONSTRAINT attachment_uploader_type_check CHECK ((uploader_type = ANY (ARRAY['member'::text, 'agent'::text])))
);

CREATE TABLE autopilot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    assignee_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    execution_mode text DEFAULT 'run_only'::text NOT NULL,
    created_by_type text NOT NULL,
    created_by_id uuid NOT NULL,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assignee_type text DEFAULT 'agent'::text NOT NULL,
    pause_reason text,
    CONSTRAINT autopilot_assignee_type_check CHECK ((assignee_type = ANY (ARRAY['agent'::text]))),
    CONSTRAINT autopilot_created_by_type_check CHECK ((created_by_type = ANY (ARRAY['member'::text, 'agent'::text]))),
    CONSTRAINT autopilot_execution_mode_check CHECK ((execution_mode = ANY (ARRAY['run_only'::text]))),
    CONSTRAINT autopilot_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text])))
);

CREATE TABLE autopilot_collaborator (
    autopilot_id uuid NOT NULL,
    user_type text NOT NULL,
    user_id uuid NOT NULL,
    granted_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT autopilot_collaborator_user_type_check CHECK ((user_type = 'member'::text))
);

CREATE TABLE autopilot_quota_period (
    workspace_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    used_count bigint DEFAULT 0 NOT NULL,
    reserved_count bigint DEFAULT 0 NOT NULL,
    blocked_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rejection_notified_at timestamp with time zone,
    CONSTRAINT autopilot_quota_period_check CHECK ((period_start < period_end)),
    CONSTRAINT autopilot_quota_period_reserved_count_check CHECK ((reserved_count >= 0)),
    CONSTRAINT autopilot_quota_period_used_count_check CHECK ((used_count >= 0))
);

CREATE TABLE autopilot_quota_reservation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    policy_revision bigint NOT NULL,
    subscription_version bigint NOT NULL,
    source text NOT NULL,
    idempotency_key text NOT NULL,
    state text DEFAULT 'reserved'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finalized_at timestamp with time zone,
    CONSTRAINT autopilot_quota_reservation_check CHECK ((period_start < period_end)),
    CONSTRAINT autopilot_quota_reservation_state_check CHECK ((state = ANY (ARRAY['reserved'::text, 'consumed'::text, 'released'::text])))
);

CREATE TABLE autopilot_rule_version (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    autopilot_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    published_by_type text NOT NULL,
    published_by_id uuid,
    config_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE autopilot_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    autopilot_id uuid NOT NULL,
    trigger_id uuid,
    source text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    task_id uuid,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    failure_reason text,
    trigger_payload jsonb,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    planned_at timestamp with time zone,
    webhook_delivery_id uuid,
    quota_reservation_id uuid,
    reason_code text,
    CONSTRAINT autopilot_run_source_check CHECK ((source = ANY (ARRAY['schedule'::text, 'manual'::text, 'webhook'::text, 'api'::text]))),
    CONSTRAINT autopilot_run_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'skipped'::text])))
);

CREATE TABLE autopilot_trigger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    autopilot_id uuid NOT NULL,
    kind text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    cron_expression text,
    timezone text DEFAULT 'UTC'::text,
    next_run_at timestamp with time zone,
    webhook_token text,
    label text,
    last_fired_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider text DEFAULT 'generic'::text NOT NULL,
    signing_secret text,
    event_filters jsonb,
    published_by_type text,
    published_by_id uuid,
    created_by_type text,
    created_by_id uuid,
    CONSTRAINT autopilot_trigger_kind_check CHECK ((kind = ANY (ARRAY['schedule'::text, 'webhook'::text, 'api'::text]))),
    CONSTRAINT autopilot_trigger_provider_check CHECK ((provider = ANY (ARRAY['generic'::text, 'github'::text])))
);

CREATE TABLE channel_binding_token (
    token_hash text NOT NULL,
    workspace_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    channel_type text NOT NULL,
    channel_user_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channel_binding_token_ttl_cap CHECK ((expires_at <= (created_at + '00:15:00'::interval)))
);

CREATE TABLE channel_chat_context_generation (
    chat_session_id uuid NOT NULL,
    revision bigint NOT NULL,
    history_start_message_id text,
    history_end_message_id text,
    history_boundary_pending boolean DEFAULT false NOT NULL,
    pending_fresh boolean DEFAULT false NOT NULL,
    initiator_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_id text,
    last_thread_id text,
    last_sender_id text
);

CREATE TABLE channel_chat_session_binding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_session_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    channel_type text NOT NULL,
    channel_chat_id text NOT NULL,
    chat_type text NOT NULL,
    last_message_id text,
    last_thread_id text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pending_fresh boolean DEFAULT false NOT NULL,
    context_revision bigint DEFAULT 1 NOT NULL,
    route_revision bigint DEFAULT 1 NOT NULL,
    retired_at timestamp with time zone,
    history_start_message_id text,
    history_end_message_id text,
    history_boundary_pending boolean DEFAULT false NOT NULL,
    CONSTRAINT channel_chat_session_binding_chat_type_check CHECK ((chat_type = ANY (ARRAY['p2p'::text, 'group'::text])))
);

CREATE TABLE channel_inbound_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    installation_id uuid,
    channel_type text NOT NULL,
    channel_chat_id text,
    event_type text NOT NULL,
    channel_event_id text,
    channel_message_id text,
    drop_reason text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE channel_inbound_message_dedup (
    installation_id uuid NOT NULL,
    message_id text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    claim_token uuid DEFAULT gen_random_uuid() NOT NULL
);

CREATE TABLE channel_installation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    channel_type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    ws_lease_token text,
    ws_lease_expires_at timestamp with time zone,
    installer_user_id uuid NOT NULL,
    installed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channel_installation_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
);

CREATE TABLE channel_media_pending_object (
    storage_key text NOT NULL,
    workspace_id uuid NOT NULL,
    chat_message_id uuid NOT NULL,
    storage_url text NOT NULL,
    installation_id uuid,
    state text DEFAULT 'pending'::text NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    attempt integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    tombstone_pass integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channel_media_pending_object_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'deleting'::text, 'tombstoned'::text])))
);

CREATE TABLE channel_outbound_card_message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_session_id uuid NOT NULL,
    task_id uuid,
    channel_type text NOT NULL,
    channel_chat_id text NOT NULL,
    channel_card_message_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    last_patched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channel_outbound_card_message_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'streaming'::text, 'final'::text, 'error'::text])))
);

CREATE TABLE channel_outbound_message (
    installation_id uuid NOT NULL,
    channel_type text NOT NULL,
    channel_message_id text NOT NULL,
    binding_id uuid NOT NULL,
    route_revision bigint NOT NULL,
    task_id uuid,
    outbound_kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE channel_reply_delivery (
    turn_id uuid NOT NULL,
    task_id uuid NOT NULL,
    binding_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    channel_type text NOT NULL,
    chat_id text NOT NULL,
    phase text NOT NULL,
    send_state text NOT NULL,
    message_id text DEFAULT ''::text NOT NULL,
    chunks_sent integer DEFAULT 0 NOT NULL,
    owner_token uuid,
    owner_expires_at timestamp with time zone,
    settled_reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    attempt_depth integer DEFAULT 0 NOT NULL,
    CONSTRAINT channel_reply_delivery_attempt_depth_check CHECK ((attempt_depth >= 0)),
    CONSTRAINT channel_reply_delivery_chunks_sent_check CHECK ((chunks_sent >= 0)),
    CONSTRAINT channel_reply_delivery_phase_check CHECK ((phase = ANY (ARRAY['streaming'::text, 'terminal'::text, 'settled'::text]))),
    CONSTRAINT channel_reply_delivery_send_state_check CHECK ((send_state = ANY (ARRAY['none'::text, 'in_flight'::text, 'known'::text, 'unknown'::text])))
);

CREATE TABLE channel_task_delivery (
    task_id uuid NOT NULL,
    binding_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    channel_type text NOT NULL,
    channel_chat_id text NOT NULL,
    chat_type text NOT NULL,
    channel_message_id text,
    channel_thread_id text,
    route_revision bigint NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    channel_sender_id text
);

CREATE TABLE channel_user_binding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    auro_user_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    channel_type text NOT NULL,
    channel_user_id text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    bound_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE chat_draft_restore (
    id uuid NOT NULL,
    chat_session_id uuid NOT NULL,
    task_id uuid NOT NULL,
    content text NOT NULL,
    attachment_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE chat_message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_session_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    task_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    failure_reason text,
    elapsed_ms bigint,
    message_kind text DEFAULT 'message'::text NOT NULL,
    channel_media_pending_until timestamp with time zone,
    channel_ingested boolean DEFAULT false NOT NULL,
    quick_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    channel_context_revision bigint,
    channel_outbound_type text,
    channel_outbound_installation_id uuid,
    channel_outbound_chat_id text,
    channel_outbound_message_ids text[],
    CONSTRAINT chat_message_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

CREATE TABLE chat_pinned_agent (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE chat_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    session_id text,
    work_dir text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    unread_since timestamp with time zone,
    runtime_id uuid,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL,
    pinned_at timestamp with time zone,
    explicitly_created_at timestamp with time zone,
    CONSTRAINT chat_session_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);

CREATE TABLE client_usage_daily (
    user_id uuid NOT NULL,
    client_type text NOT NULL,
    install_id uuid NOT NULL,
    activity_date date NOT NULL,
    workspace_id uuid,
    client_version text NOT NULL,
    os text NOT NULL,
    first_active_at timestamp with time zone NOT NULL,
    last_active_at timestamp with time zone NOT NULL,
    runtime_probed_at timestamp with time zone,
    probe_result text,
    runtime_count integer,
    provider_summary jsonb,
    online_count integer,
    offline_count integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_usage_daily_check CHECK ((first_active_at <= last_active_at)),
    CONSTRAINT client_usage_daily_check1 CHECK ((((runtime_probed_at IS NULL) AND (probe_result IS NULL) AND (runtime_count IS NULL) AND (provider_summary IS NULL) AND (online_count IS NULL) AND (offline_count IS NULL)) OR ((runtime_probed_at IS NOT NULL) AND (probe_result = 'error'::text) AND (runtime_count IS NULL) AND (provider_summary IS NULL) AND (online_count IS NULL) AND (offline_count IS NULL)) OR ((runtime_probed_at IS NOT NULL) AND (probe_result = 'success'::text) AND (runtime_count IS NOT NULL) AND (provider_summary IS NOT NULL) AND (online_count IS NOT NULL) AND (offline_count IS NOT NULL) AND ((online_count + offline_count) = runtime_count) AND (jsonb_typeof(provider_summary) = 'object'::text)))),
    CONSTRAINT client_usage_daily_client_type_check CHECK ((client_type = ANY (ARRAY['web'::text, 'desktop'::text]))),
    CONSTRAINT client_usage_daily_offline_count_check CHECK ((offline_count >= 0)),
    CONSTRAINT client_usage_daily_online_count_check CHECK ((online_count >= 0)),
    CONSTRAINT client_usage_daily_probe_result_check CHECK ((probe_result = ANY (ARRAY['success'::text, 'error'::text]))),
    CONSTRAINT client_usage_daily_runtime_count_check CHECK ((runtime_count >= 0))
);

CREATE TABLE contact_sales_inquiry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    business_email text NOT NULL,
    company_name text NOT NULL,
    company_size text NOT NULL,
    country_region text NOT NULL,
    use_case text NOT NULL,
    goals text DEFAULT ''::text NOT NULL,
    consent_outreach boolean DEFAULT false NOT NULL,
    consent_updates boolean DEFAULT false NOT NULL,
    submitter_ip inet,
    user_agent text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE daemon_connection (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    daemon_id text NOT NULL,
    status text DEFAULT 'disconnected'::text NOT NULL,
    last_heartbeat_at timestamp with time zone,
    runtime_info jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT daemon_connection_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'disconnected'::text])))
);

CREATE TABLE daemon_token (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    workspace_id uuid NOT NULL,
    daemon_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE dingtalk_bot_identity (
    workspace_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    bot_name text DEFAULT ''::text NOT NULL,
    bot_identity_issue text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE dingtalk_group_presence (
    workspace_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    conversation_id text NOT NULL,
    conversation_title text DEFAULT ''::text NOT NULL,
    bot_name text DEFAULT ''::text NOT NULL,
    bot_identity_issue text DEFAULT ''::text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone,
    mention_count bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dingtalk_group_presence_mention_count_check CHECK ((mention_count >= 0))
);

CREATE TABLE dingtalk_group_route (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    conversation_id text NOT NULL,
    conversation_title text DEFAULT ''::text NOT NULL,
    agent_id uuid NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid,
    message text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE game_policy (
    game_id text NOT NULL,
    scope text NOT NULL,
    default_visible boolean NOT NULL,
    revision integer NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT game_policy_game_id_check CHECK ((game_id = ANY (ARRAY['siege'::text, 'tanks'::text, 'life'::text]))),
    CONSTRAINT game_policy_revision_check CHECK ((revision > 0)),
    CONSTRAINT game_policy_scope_check CHECK ((scope = ANY (ARRAY['all'::text, 'selected'::text, 'bound'::text, 'disabled'::text])))
);

CREATE TABLE game_policy_audit (
    game_id text NOT NULL,
    revision integer NOT NULL,
    actor_id uuid NOT NULL,
    previous jsonb NOT NULL,
    current jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE game_progress (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    game text NOT NULL,
    payload jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE game_world_override (
    game_id text NOT NULL,
    workspace_id uuid NOT NULL,
    access text NOT NULL,
    visibility text NOT NULL,
    CONSTRAINT game_world_override_access_check CHECK ((access = ANY (ARRAY['inherit'::text, 'allow'::text, 'deny'::text]))),
    CONSTRAINT game_world_override_game_id_check CHECK ((game_id = ANY (ARRAY['siege'::text, 'tanks'::text, 'life'::text]))),
    CONSTRAINT game_world_override_visibility_check CHECK ((visibility = ANY (ARRAY['inherit'::text, 'show'::text, 'hide'::text])))
);

CREATE TABLE github_installation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    installation_id bigint NOT NULL,
    account_login text NOT NULL,
    account_type text DEFAULT 'User'::text NOT NULL,
    account_avatar_url text,
    connected_by_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT github_installation_account_type_check CHECK ((account_type = ANY (ARRAY['User'::text, 'Organization'::text])))
);

CREATE TABLE github_pending_installation (
    installation_id bigint NOT NULL,
    account_login text NOT NULL,
    account_type text DEFAULT 'User'::text NOT NULL,
    account_avatar_url text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT github_pending_installation_account_login_check CHECK ((account_login <> ''::text)),
    CONSTRAINT github_pending_installation_account_type_check CHECK ((account_type = ANY (ARRAY['User'::text, 'Organization'::text])))
);

CREATE TABLE inbox_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    recipient_type text NOT NULL,
    recipient_id uuid NOT NULL,
    type text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    body text,
    read boolean DEFAULT false NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_type text,
    actor_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    content jsonb,
    CONSTRAINT inbox_item_recipient_type_check CHECK ((recipient_type = ANY (ARRAY['member'::text, 'agent'::text]))),
    CONSTRAINT inbox_item_severity_check CHECK ((severity = ANY (ARRAY['action_required'::text, 'attention'::text, 'info'::text])))
);

CREATE TABLE instance_telemetry_state (
    singleton boolean DEFAULT true NOT NULL,
    instance_id uuid DEFAULT gen_random_uuid() NOT NULL,
    last_successful_day date,
    pending_day date,
    pending_body bytea,
    next_attempt_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instance_telemetry_state_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT instance_telemetry_state_check CHECK ((((pending_day IS NULL) AND (pending_body IS NULL) AND (next_attempt_at IS NULL) AND (attempt_count = 0)) OR ((pending_day IS NOT NULL) AND (pending_body IS NOT NULL) AND (next_attempt_at IS NOT NULL)))),
    CONSTRAINT instance_telemetry_state_singleton_check CHECK (singleton)
);

CREATE TABLE label (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    color text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resource_type text DEFAULT 'agent'::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    CONSTRAINT label_resource_type_check CHECK ((resource_type = ANY (ARRAY['agent'::text, 'skill'::text])))
);

CREATE TABLE lark_binding_token (
    token_hash text NOT NULL,
    workspace_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    lark_open_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lark_binding_token_ttl_cap CHECK ((expires_at <= (created_at + '00:15:00'::interval)))
);

CREATE TABLE lark_chat_session_binding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_session_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    lark_chat_id text NOT NULL,
    lark_chat_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_lark_message_id text,
    last_lark_thread_id text,
    CONSTRAINT lark_chat_session_binding_lark_chat_type_check CHECK ((lark_chat_type = ANY (ARRAY['p2p'::text, 'group'::text])))
);

CREATE TABLE lark_inbound_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    installation_id uuid,
    lark_chat_id text,
    event_type text NOT NULL,
    lark_event_id text,
    lark_message_id text,
    drop_reason text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE lark_inbound_message_dedup (
    installation_id uuid NOT NULL,
    message_id text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    claim_token uuid DEFAULT gen_random_uuid() NOT NULL
);

CREATE TABLE lark_installation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    app_id text NOT NULL,
    app_secret_encrypted bytea NOT NULL,
    tenant_key text,
    bot_open_id text NOT NULL,
    installer_user_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    ws_lease_token text,
    ws_lease_expires_at timestamp with time zone,
    installed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bot_union_id text,
    region text DEFAULT 'feishu'::text NOT NULL,
    CONSTRAINT lark_installation_region_check CHECK ((region = ANY (ARRAY['feishu'::text, 'lark'::text]))),
    CONSTRAINT lark_installation_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
);

CREATE TABLE lark_outbound_card_message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_session_id uuid NOT NULL,
    task_id uuid,
    lark_chat_id text NOT NULL,
    lark_card_message_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    last_patched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lark_outbound_card_message_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'streaming'::text, 'final'::text, 'error'::text])))
);

CREATE TABLE lark_user_binding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    auro_user_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    lark_open_id text NOT NULL,
    union_id text,
    bound_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE life_action (
    world_id uuid NOT NULL,
    id uuid NOT NULL,
    agent_id uuid NOT NULL,
    intent jsonb NOT NULL,
    reason text NOT NULL,
    started_tick bigint NOT NULL,
    due_tick bigint NOT NULL,
    status text NOT NULL,
    completed_tick bigint,
    CONSTRAINT life_action_check CHECK ((due_tick > started_tick)),
    CONSTRAINT life_action_check1 CHECK ((completed_tick >= due_tick)),
    CONSTRAINT life_action_check2 CHECK ((((status = 'running'::text) AND (completed_tick IS NULL)) OR ((status <> 'running'::text) AND (completed_tick IS NOT NULL)))),
    CONSTRAINT life_action_intent_check CHECK (((intent ->> 'kind'::text) = ANY (ARRAY['MOVE'::text, 'REST'::text, 'EAT'::text, 'GATHER_WOOD'::text, 'WORK'::text, 'TALK'::text]))),
    CONSTRAINT life_action_started_tick_check CHECK ((started_tick >= 0)),
    CONSTRAINT life_action_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))
);

CREATE TABLE life_agent (
    world_id uuid NOT NULL,
    id uuid NOT NULL,
    name text NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    energy integer NOT NULL,
    fullness integer NOT NULL,
    social integer NOT NULL,
    personality jsonb NOT NULL,
    goal jsonb NOT NULL,
    CONSTRAINT life_agent_energy_check CHECK (((energy >= 0) AND (energy <= 100))),
    CONSTRAINT life_agent_fullness_check CHECK (((fullness >= 0) AND (fullness <= 100))),
    CONSTRAINT life_agent_social_check CHECK (((social >= 0) AND (social <= 100))),
    CONSTRAINT life_agent_x_check CHECK (((x >= 0) AND (x <= 11))),
    CONSTRAINT life_agent_y_check CHECK (((y >= 0) AND (y <= 7)))
);

CREATE TABLE life_event (
    world_id uuid NOT NULL,
    id uuid NOT NULL,
    tick bigint NOT NULL,
    action_id uuid,
    agent_id uuid,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT life_event_tick_check CHECK ((tick >= 0))
);

CREATE TABLE life_resource (
    world_id uuid NOT NULL,
    owner text NOT NULL,
    kind text NOT NULL,
    amount integer NOT NULL,
    CONSTRAINT life_resource_amount_check CHECK ((amount >= 0)),
    CONSTRAINT life_resource_kind_check CHECK ((kind = ANY (ARRAY['food'::text, 'wood'::text, 'coins'::text])))
);

CREATE TABLE life_world (
    id uuid NOT NULL,
    singleton boolean DEFAULT true NOT NULL,
    workspace_id uuid NOT NULL,
    tick bigint DEFAULT 0 NOT NULL,
    tick_ms integer DEFAULT 2000 NOT NULL,
    next_tick_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT life_world_singleton_check CHECK (singleton),
    CONSTRAINT life_world_tick_check CHECK ((tick >= 0)),
    CONSTRAINT life_world_tick_ms_check CHECK (((tick_ms >= 100) AND (tick_ms <= 60000)))
);

CREATE TABLE maintenance_job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_type text NOT NULL,
    job_version integer NOT NULL,
    scope_key text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    status text NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    dry_run boolean DEFAULT true NOT NULL,
    options jsonb NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    checkpoint jsonb DEFAULT '{}'::jsonb NOT NULL,
    progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_error text DEFAULT ''::text NOT NULL,
    next_allowed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT maintenance_job_check CHECK (((jsonb_typeof(options) = 'object'::text) AND (jsonb_typeof(parameters) = 'object'::text) AND (jsonb_typeof(checkpoint) = 'object'::text) AND (jsonb_typeof(progress) = 'object'::text) AND (jsonb_typeof(result) = 'object'::text))),
    CONSTRAINT maintenance_job_job_version_check CHECK ((job_version > 0)),
    CONSTRAINT maintenance_job_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'paused'::text, 'completed'::text, 'cancelled'::text])))
);

CREATE TABLE mcp_activity (
    id uuid NOT NULL,
    service_id text NOT NULL,
    workspace_id uuid,
    actor_id uuid NOT NULL,
    kind text NOT NULL,
    tool_name text DEFAULT ''::text NOT NULL,
    outcome text NOT NULL,
    error_code text DEFAULT ''::text NOT NULL,
    duration_ms bigint DEFAULT 0 NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE mcp_service_policy (
    service_id text NOT NULL,
    enabled boolean NOT NULL,
    disabled_tools text[] DEFAULT '{}'::text[] NOT NULL,
    revision integer NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE member (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);

CREATE TABLE notification_preference (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE personal_access_token (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE plugin_hook_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    installation_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    hook_key text NOT NULL,
    cron_expression text NOT NULL,
    timezone text NOT NULL,
    generation uuid DEFAULT gen_random_uuid() NOT NULL,
    activated_at timestamp with time zone DEFAULT now() NOT NULL,
    next_run_at timestamp with time zone,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_hook_schedule_cron_expression_check CHECK (((char_length(cron_expression) >= 1) AND (char_length(cron_expression) <= 255))),
    CONSTRAINT plugin_hook_schedule_hook_key_check CHECK (((char_length(hook_key) >= 1) AND (char_length(hook_key) <= 128))),
    CONSTRAINT plugin_hook_schedule_timezone_check CHECK (((char_length(timezone) >= 1) AND (char_length(timezone) <= 255)))
);

CREATE TABLE plugin_installation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    plugin_key text NOT NULL,
    version text NOT NULL,
    manifest jsonb NOT NULL,
    granted_scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    installed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    token_hash text,
    token_rotated_at timestamp with time zone,
    mcp_approvals jsonb DEFAULT '{}'::jsonb NOT NULL,
    package_version_id uuid NOT NULL,
    CONSTRAINT plugin_installation_config_check CHECK ((jsonb_typeof(config) = 'object'::text)),
    CONSTRAINT plugin_installation_granted_scopes_check CHECK ((jsonb_typeof(granted_scopes) = 'array'::text)),
    CONSTRAINT plugin_installation_manifest_check CHECK ((jsonb_typeof(manifest) = 'object'::text)),
    CONSTRAINT plugin_installation_mcp_approvals_check CHECK ((jsonb_typeof(mcp_approvals) = 'object'::text)),
    CONSTRAINT plugin_installation_plugin_key_check CHECK (((char_length(plugin_key) >= 3) AND (char_length(plugin_key) <= 255))),
    CONSTRAINT plugin_installation_version_check CHECK (((char_length(version) >= 1) AND (char_length(version) <= 64)))
);

CREATE TABLE plugin_invocation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    installation_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    hook_key text NOT NULL,
    trigger text NOT NULL,
    status text NOT NULL,
    event_type text,
    attempt integer DEFAULT 1 NOT NULL,
    latency_ms integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivery_id text,
    planned_at timestamp with time zone,
    CONSTRAINT plugin_invocation_attempt_check CHECK (((attempt >= 1) AND (attempt <= 10))),
    CONSTRAINT plugin_invocation_delivery_id_check CHECK (((delivery_id IS NULL) OR ((char_length(delivery_id) >= 1) AND (char_length(delivery_id) <= 128)))),
    CONSTRAINT plugin_invocation_error_check CHECK (((error IS NULL) OR (char_length(error) <= 500))),
    CONSTRAINT plugin_invocation_hook_key_check CHECK (((char_length(hook_key) >= 1) AND (char_length(hook_key) <= 128))),
    CONSTRAINT plugin_invocation_latency_ms_check CHECK ((latency_ms >= 0)),
    CONSTRAINT plugin_invocation_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'failed'::text, 'timeout'::text, 'refused'::text]))),
    CONSTRAINT plugin_invocation_trigger_check CHECK ((trigger = ANY (ARRAY['ui'::text, 'manual'::text, 'event'::text, 'agent'::text, 'schedule'::text])))
);

CREATE TABLE plugin_package (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    plugin_key text NOT NULL,
    name text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_package_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 160))),
    CONSTRAINT plugin_package_plugin_key_check CHECK (((char_length(plugin_key) >= 3) AND (char_length(plugin_key) <= 255)))
);

CREATE TABLE plugin_package_file (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_id uuid NOT NULL,
    path text NOT NULL,
    content bytea NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_package_file_path_check CHECK (((char_length(path) >= 1) AND (char_length(path) <= 1024))),
    CONSTRAINT plugin_package_file_sha256_check CHECK ((char_length(sha256) = 64)),
    CONSTRAINT plugin_package_file_size_bytes_check CHECK ((size_bytes >= 0))
);

CREATE TABLE plugin_package_version (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    version text NOT NULL,
    manifest jsonb NOT NULL,
    digest text NOT NULL,
    size_bytes bigint NOT NULL,
    published_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_package_version_digest_check CHECK ((char_length(digest) = 64)),
    CONSTRAINT plugin_package_version_manifest_check CHECK ((jsonb_typeof(manifest) = 'object'::text)),
    CONSTRAINT plugin_package_version_size_bytes_check CHECK ((size_bytes >= 0)),
    CONSTRAINT plugin_package_version_version_check CHECK (((char_length(version) >= 1) AND (char_length(version) <= 64)))
);

CREATE TABLE plugin_secret (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    installation_id uuid NOT NULL,
    key text NOT NULL,
    ciphertext bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_secret_ciphertext_check CHECK ((octet_length(ciphertext) > 0)),
    CONSTRAINT plugin_secret_key_check CHECK (((char_length(key) >= 1) AND (char_length(key) <= 128)))
);

CREATE TABLE plugin_storage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    installation_id uuid NOT NULL,
    scope_type text NOT NULL,
    scope_id uuid NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_storage_key_check CHECK (((octet_length(key) >= 1) AND (octet_length(key) <= 1024))),
    CONSTRAINT plugin_storage_scope_type_check CHECK ((scope_type = ANY (ARRAY['workspace'::text, 'user'::text]))),
    CONSTRAINT plugin_storage_value_check CHECK ((octet_length(value) <= 102400))
);

CREATE TABLE runtime_profile (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    display_name text NOT NULL,
    protocol_family text NOT NULL,
    command_name text NOT NULL,
    description text,
    fixed_args jsonb DEFAULT '[]'::jsonb NOT NULL,
    visibility text DEFAULT 'workspace'::text NOT NULL,
    created_by uuid,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    runtime_type text DEFAULT ''::text NOT NULL,
    CONSTRAINT runtime_profile_visibility_check CHECK ((visibility = ANY (ARRAY['workspace'::text, 'private'::text])))
);

CREATE TABLE seat_capacity_outbox (
    workspace_id uuid NOT NULL,
    operation_token uuid NOT NULL,
    action text NOT NULL,
    subject_id uuid,
    member_id uuid,
    invitation_id uuid,
    share_link_id uuid,
    user_id uuid,
    expires_at timestamp with time zone,
    delivered_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    last_error text,
    dead_lettered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seat_capacity_outbox_action_check CHECK ((action = ANY (ARRAY['reserve_invitation'::text, 'consume_invitation'::text, 'claim_share_join'::text, 'confirm'::text, 'release'::text, 'release_member'::text]))),
    CONSTRAINT seat_capacity_outbox_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT seat_capacity_outbox_check CHECK (((action <> 'reserve_invitation'::text) OR ((invitation_id IS NOT NULL) AND (expires_at IS NOT NULL)))),
    CONSTRAINT seat_capacity_outbox_check1 CHECK (((action <> 'consume_invitation'::text) OR ((invitation_id IS NOT NULL) AND (user_id IS NOT NULL)))),
    CONSTRAINT seat_capacity_outbox_check2 CHECK (((action <> 'claim_share_join'::text) OR ((share_link_id IS NOT NULL) AND (user_id IS NOT NULL)))),
    CONSTRAINT seat_capacity_outbox_check3 CHECK (((action <> 'confirm'::text) OR (member_id IS NOT NULL))),
    CONSTRAINT seat_capacity_outbox_check4 CHECK (((action <> 'release_member'::text) OR (member_id IS NOT NULL)))
);

CREATE TABLE siege_recognition_budget (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    day date NOT NULL,
    count integer DEFAULT 0 NOT NULL
);

CREATE TABLE siege_session (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE skill (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    plugin_installation_id uuid
);

CREATE TABLE skill_file (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    skill_id uuid NOT NULL,
    path text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE skill_to_label (
    skill_id uuid NOT NULL,
    label_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE sys_cron_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_name text NOT NULL,
    scope_kind text DEFAULT 'global'::text NOT NULL,
    scope_id text DEFAULT 'global'::text NOT NULL,
    plan_time timestamp with time zone NOT NULL,
    status text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    next_retry_at timestamp with time zone,
    runner_id text,
    lease_token uuid DEFAULT gen_random_uuid() NOT NULL,
    heartbeat_at timestamp with time zone,
    stale_after timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    duration_ms integer,
    rows_affected bigint,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_code text,
    error_msg text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_sys_cron_attempt CHECK (((attempt >= 1) AND (max_attempts >= attempt))),
    CONSTRAINT chk_sys_cron_duration CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))),
    CONSTRAINT chk_sys_cron_status CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCESS'::text, 'FAILED'::text])))
);

CREATE TABLE tank_character (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    revision integer NOT NULL,
    payload jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    experience integer DEFAULT 0 NOT NULL,
    CONSTRAINT tank_character_experience_check CHECK (((experience >= 0) AND (experience <= 2700)))
);

CREATE TABLE tank_character_revision (
    character_id uuid NOT NULL,
    revision integer NOT NULL,
    workspace_id uuid NOT NULL,
    payload jsonb NOT NULL
);

CREATE TABLE tank_play_session (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    payload jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE tank_request (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    operation text NOT NULL,
    request_id uuid NOT NULL,
    body_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE tank_training_run (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    character_id uuid NOT NULL,
    level_id integer NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    body_hash text,
    result jsonb,
    CONSTRAINT tank_training_run_level_id_check CHECK (((level_id >= 1) AND (level_id <= 6)))
);

CREATE TABLE task_message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    seq integer NOT NULL,
    type text NOT NULL,
    tool text,
    content text,
    input jsonb,
    output text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    output_truncated boolean,
    call_id text
);

CREATE TABLE task_token (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    task_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE task_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    provider text DEFAULT ''::text NOT NULL,
    model text NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cache_read_tokens bigint DEFAULT 0 NOT NULL,
    cache_write_tokens bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    cost_usd_ticks bigint
);

CREATE TABLE task_usage_hourly (
    bucket_hour timestamp with time zone NOT NULL,
    workspace_id uuid NOT NULL,
    runtime_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cache_read_tokens bigint DEFAULT 0 NOT NULL,
    cache_write_tokens bigint DEFAULT 0 NOT NULL,
    task_count bigint DEFAULT 0 NOT NULL,
    event_count bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cost_usd_ticks bigint DEFAULT 0 NOT NULL,
    uncosted_input_tokens bigint,
    uncosted_output_tokens bigint,
    uncosted_cache_read_tokens bigint,
    uncosted_cache_write_tokens bigint
);

CREATE TABLE task_usage_hourly_dirty (
    bucket_hour timestamp with time zone NOT NULL,
    workspace_id uuid NOT NULL,
    runtime_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE task_usage_hourly_rollup_state (
    id smallint DEFAULT 1 NOT NULL,
    watermark_at timestamp with time zone DEFAULT '1970-01-01 08:00:00+08'::timestamp with time zone NOT NULL,
    last_run_started_at timestamp with time zone,
    last_run_finished_at timestamp with time zone,
    last_run_rows bigint DEFAULT 0 NOT NULL,
    last_error text,
    CONSTRAINT task_usage_hourly_rollup_state_id_check CHECK ((id = 1))
);

CREATE TABLE "user" (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    onboarded_at timestamp with time zone,
    onboarding_questionnaire jsonb DEFAULT '{}'::jsonb NOT NULL,
    cloud_waitlist_email character varying(254),
    cloud_waitlist_reason text,
    starter_content_state text,
    language character varying(20) DEFAULT NULL::character varying,
    profile_description text DEFAULT ''::text NOT NULL,
    timezone text,
    password_hash text DEFAULT ''::text NOT NULL
);

CREATE TABLE user_composio_connection (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    toolkit_slug text NOT NULL,
    auth_config_id text NOT NULL,
    connected_account_id text NOT NULL,
    composio_user_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE vcs_connection (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    provider text DEFAULT 'forgejo'::text NOT NULL,
    instance_url text NOT NULL,
    account_login text NOT NULL,
    access_token_encrypted text NOT NULL,
    webhook_secret_encrypted text NOT NULL,
    connected_by_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vcs_connection_provider_check CHECK ((provider = ANY (ARRAY['forgejo'::text, 'gitea'::text, 'gitlab'::text])))
);

CREATE TABLE verification_code (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL
);

CREATE TABLE webhook_delivery (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    autopilot_id uuid NOT NULL,
    trigger_id uuid NOT NULL,
    provider text NOT NULL,
    event text DEFAULT 'webhook.received'::text NOT NULL,
    dedupe_key text,
    dedupe_source text,
    signature_status text DEFAULT 'not_required'::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempt_count integer DEFAULT 1 NOT NULL,
    selected_headers jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_type text,
    raw_body bytea,
    response_status integer,
    response_body text,
    autopilot_run_id uuid,
    replayed_from_delivery_id uuid,
    error text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    last_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    dispatch_attempts integer DEFAULT 0 NOT NULL,
    reason_code text,
    replay_idempotency_key text,
    CONSTRAINT webhook_delivery_provider_check CHECK ((provider = ANY (ARRAY['generic'::text, 'github'::text]))),
    CONSTRAINT webhook_delivery_signature_status_check CHECK ((signature_status = ANY (ARRAY['not_required'::text, 'valid'::text, 'invalid'::text, 'missing'::text]))),
    CONSTRAINT webhook_delivery_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'dispatched'::text, 'rejected'::text, 'ignored'::text, 'failed'::text])))
);

CREATE TABLE workspace (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    context text,
    repos jsonb DEFAULT '[]'::jsonb NOT NULL,
    avatar_url text,
    attribution_fail_closed boolean DEFAULT false NOT NULL
);

CREATE TABLE workspace_invitation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    inviter_id uuid NOT NULL,
    invitee_email text NOT NULL,
    invitee_user_id uuid,
    role text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    CONSTRAINT workspace_invitation_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text]))),
    CONSTRAINT workspace_invitation_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text])))
);

CREATE TABLE workspace_mcp_server (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    config jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE workspace_share_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code text NOT NULL,
    created_by uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    expires_at timestamp with time zone,
    max_uses integer,
    use_count integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_share_link_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);

CREATE TABLE world_inbox_event (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    actor_id uuid,
    subject_id uuid NOT NULL,
    kind text NOT NULL,
    content jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    delivered_at timestamp with time zone,
    summarized_at timestamp with time zone,
    CONSTRAINT world_inbox_event_kind_check CHECK ((kind = ANY (ARRAY['tank_created'::text, 'tank_updated'::text, 'tank_level_up'::text, 'resident_goal_reached'::text])))
);

CREATE FUNCTION clear_runtime_mcp_overlay_on_terminal_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.status IN ('completed', 'failed', 'cancelled')
       AND OLD.status IS DISTINCT FROM NEW.status
       AND (NEW.runtime_mcp_overlay IS NOT NULL OR NEW.runtime_connected_apps IS NOT NULL) THEN
        NEW.runtime_mcp_overlay := NULL;
        NEW.runtime_connected_apps := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_channel_message_task_context_revision() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    task_revision BIGINT;
BEGIN
    IF OLD.task_id IS NOT NULL
       OR NEW.task_id IS NULL
       OR NEW.role <> 'user' THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(task.channel_context_revision, 1)
    INTO task_revision
    FROM agent_task_queue AS task
    WHERE task.id = NEW.task_id;

    IF task_revision IS NOT NULL
       AND COALESCE(NEW.channel_context_revision, 1) <> task_revision THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION enqueue_task_usage_hourly_dirty_for_atq() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.runtime_id IS DISTINCT FROM NEW.runtime_id
           OR OLD.agent_id IS DISTINCT FROM NEW.agent_id THEN
            IF OLD.runtime_id IS NOT NULL THEN
                INSERT INTO task_usage_hourly_dirty (
                    bucket_hour, workspace_id, runtime_id, agent_id,
                    provider, model
                )
                SELECT DISTINCT
                    task_usage_hour_bucket(tu.created_at),
                    a.workspace_id,
                    OLD.runtime_id,
                    OLD.agent_id,
                    tu.provider,
                    tu.model
                  FROM task_usage tu
                  JOIN agent a ON a.id = OLD.agent_id
                 WHERE tu.task_id = OLD.id
                ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_dirty_key DO UPDATE
                    SET enqueued_at = GREATEST(task_usage_hourly_dirty.enqueued_at, EXCLUDED.enqueued_at);
            END IF;

            IF NEW.runtime_id IS NOT NULL THEN
                INSERT INTO task_usage_hourly_dirty (
                    bucket_hour, workspace_id, runtime_id, agent_id,
                    provider, model
                )
                SELECT DISTINCT
                    task_usage_hour_bucket(tu.created_at),
                    a.workspace_id,
                    NEW.runtime_id,
                    NEW.agent_id,
                    tu.provider,
                    tu.model
                  FROM task_usage tu
                  JOIN agent a ON a.id = NEW.agent_id
                 WHERE tu.task_id = NEW.id
                ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_dirty_key DO UPDATE
                    SET enqueued_at = GREATEST(task_usage_hourly_dirty.enqueued_at, EXCLUDED.enqueued_at);
            END IF;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.runtime_id IS NOT NULL THEN
            INSERT INTO task_usage_hourly_dirty (
                bucket_hour, workspace_id, runtime_id, agent_id,
                provider, model
            )
            SELECT DISTINCT
                task_usage_hour_bucket(tu.created_at),
                a.workspace_id,
                OLD.runtime_id,
                OLD.agent_id,
                tu.provider,
                tu.model
              FROM task_usage tu
              JOIN agent a ON a.id = OLD.agent_id
             WHERE tu.task_id = OLD.id
            ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_dirty_key DO UPDATE
                SET enqueued_at = GREATEST(task_usage_hourly_dirty.enqueued_at, EXCLUDED.enqueued_at);
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;

CREATE FUNCTION enqueue_task_usage_hourly_dirty_for_tu() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO task_usage_hourly_dirty (
        bucket_hour, workspace_id, runtime_id, agent_id,
        provider, model
    )
    SELECT
        task_usage_hour_bucket(OLD.created_at),
        a.workspace_id,
        atq.runtime_id,
        atq.agent_id,
        OLD.provider,
        OLD.model
      FROM agent_task_queue atq
      JOIN agent a ON a.id = atq.agent_id
     WHERE atq.id = OLD.task_id
       AND atq.runtime_id IS NOT NULL
    ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_dirty_key DO UPDATE
        SET enqueued_at = GREATEST(task_usage_hourly_dirty.enqueued_at, EXCLUDED.enqueued_at);
    RETURN OLD;
END;
$$;

CREATE FUNCTION lock_task_owner_rows(p_agent_id uuid, p_runtime_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    required int := (CASE WHEN p_agent_id IS NULL THEN 0 ELSE 1 END)
                  + (CASE WHEN p_runtime_id IS NULL THEN 0 ELSE 1 END);
    resolved int;
    distinct_workspaces int;
    locked int;
BEGIN
    IF required = 0 THEN
        RETURN TRUE;
    END IF;

    WITH owners AS (
        SELECT a.workspace_id FROM agent a WHERE a.id = p_agent_id
        UNION ALL
        SELECT r.workspace_id FROM agent_runtime r WHERE r.id = p_runtime_id
    )
    SELECT count(*), count(DISTINCT workspace_id)
    INTO resolved, distinct_workspaces
    FROM owners;
    IF resolved <> required THEN
        RETURN FALSE;
    END IF;
    WITH locked_workspaces AS (
        SELECT w.id
        FROM workspace w
        WHERE w.id IN (
            SELECT a.workspace_id FROM agent a WHERE a.id = p_agent_id
            UNION
            SELECT r.workspace_id FROM agent_runtime r WHERE r.id = p_runtime_id
        )
        ORDER BY w.id
        FOR KEY SHARE
    )
    SELECT count(*) INTO locked FROM locked_workspaces;

    IF locked <> distinct_workspaces THEN
        RETURN FALSE;
    END IF;
    locked := 0;

    IF p_agent_id IS NOT NULL THEN
        PERFORM 1 FROM agent WHERE id = p_agent_id FOR KEY SHARE;
        IF FOUND THEN locked := locked + 1; END IF;
    END IF;

    IF p_runtime_id IS NOT NULL THEN
        PERFORM 1 FROM agent_runtime WHERE id = p_runtime_id FOR KEY SHARE;
        IF FOUND THEN locked := locked + 1; END IF;
    END IF;

    RETURN locked = required;
END;
$$;

CREATE FUNCTION mirror_dingtalk_group_presence_bot_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.bot_name = '' AND NEW.bot_identity_issue = '' THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM dingtalk_bot_identity identity
        WHERE identity.installation_id = NEW.installation_id
          AND identity.workspace_id = NEW.workspace_id
          AND identity.bot_name = NEW.bot_name
          AND identity.bot_identity_issue = NEW.bot_identity_issue
    ) THEN
        RETURN NEW;
    END IF;

    INSERT INTO dingtalk_bot_identity (
        workspace_id, installation_id, bot_name, bot_identity_issue
    ) VALUES (
        NEW.workspace_id, NEW.installation_id, NEW.bot_name, NEW.bot_identity_issue
    )
    ON CONFLICT (installation_id) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        bot_name = CASE
            WHEN EXCLUDED.bot_name <> '' THEN EXCLUDED.bot_name
            ELSE dingtalk_bot_identity.bot_name
        END,
        bot_identity_issue = CASE
            WHEN EXCLUDED.bot_identity_issue <> '' THEN EXCLUDED.bot_identity_issue
            WHEN EXCLUDED.bot_name <> '' THEN ''
            ELSE dingtalk_bot_identity.bot_identity_issue
        END,
        updated_at = now();

    RETURN NEW;
END;
$$;

CREATE FUNCTION mirror_legacy_dingtalk_group_route_presence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    is_activity BOOLEAN;
BEGIN
    is_activity := TG_OP = 'INSERT';
    IF TG_OP = 'UPDATE' THEN
        is_activity := NEW.revision = OLD.revision;
    END IF;

    INSERT INTO dingtalk_group_presence (
        workspace_id,
        installation_id,
        conversation_id,
        conversation_title,
        first_seen_at,
        last_active_at,
        mention_count
    ) VALUES (
        NEW.workspace_id,
        NEW.installation_id,
        NEW.conversation_id,
        NEW.conversation_title,
        NEW.discovered_at,
        CASE WHEN is_activity THEN now() ELSE NULL END,
        CASE WHEN is_activity THEN 1 ELSE 0 END
    )
    ON CONFLICT (installation_id, conversation_id) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        conversation_title = CASE
            WHEN EXCLUDED.conversation_title <> '' THEN EXCLUDED.conversation_title
            ELSE dingtalk_group_presence.conversation_title
        END,
        first_seen_at = LEAST(dingtalk_group_presence.first_seen_at, EXCLUDED.first_seen_at),
        last_active_at = CASE
            WHEN is_activity THEN now()
            ELSE dingtalk_group_presence.last_active_at
        END,
        mention_count = dingtalk_group_presence.mention_count + CASE WHEN is_activity THEN 1 ELSE 0 END,
        updated_at = now();

    RETURN NEW;
END;
$$;

CREATE FUNCTION prune_task_usage_hourly_dirty(p_retention interval DEFAULT '7 days'::interval) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_rows BIGINT;
BEGIN
    DELETE FROM task_usage_hourly_dirty
     WHERE enqueued_at < now() - p_retention;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE FUNCTION rollup_task_usage_hourly() RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_lock_ok BOOLEAN;
    v_from    TIMESTAMPTZ;
    v_to      TIMESTAMPTZ;
    v_rows    BIGINT := 0;
BEGIN
    SELECT pg_try_advisory_xact_lock(4246) INTO v_lock_ok;
    IF NOT v_lock_ok THEN
        RETURN 0;
    END IF;

    BEGIN
        UPDATE task_usage_hourly_rollup_state
           SET last_run_started_at = now(),
               last_error          = NULL
         WHERE id = 1
        RETURNING watermark_at INTO v_from;
        v_to := LEAST(now() - INTERVAL '5 minutes', v_from + INTERVAL '1 day');

        IF v_from < v_to THEN
            v_rows := rollup_task_usage_hourly_window(v_from, v_to);

            UPDATE task_usage_hourly_rollup_state
               SET watermark_at         = v_to,
                   last_run_finished_at = now(),
                   last_run_rows        = v_rows
             WHERE id = 1;
        ELSE
            UPDATE task_usage_hourly_rollup_state
               SET last_run_finished_at = now(),
                   last_run_rows        = 0
             WHERE id = 1;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        UPDATE task_usage_hourly_rollup_state
           SET last_error           = SQLERRM,
               last_run_finished_at = now()
         WHERE id = 1;
        RAISE;
    END;
    PERFORM prune_task_usage_hourly_dirty();
    RETURN v_rows;
END;
$$;

CREATE FUNCTION rollup_task_usage_hourly_window(p_from timestamp with time zone, p_to timestamp with time zone) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_rows BIGINT;
BEGIN
    IF p_from >= p_to THEN
        RETURN 0;
    END IF;

    WITH
    dirty_from_updates AS (
        SELECT DISTINCT
            task_usage_hour_bucket(tu.created_at) AS bucket_hour,
            a.workspace_id                        AS workspace_id,
            atq.runtime_id                        AS runtime_id,
            atq.agent_id                          AS agent_id,
            tu.provider                           AS provider,
            tu.model                              AS model
          FROM task_usage tu
          JOIN agent_task_queue atq ON atq.id      = tu.task_id
          JOIN agent            a   ON a.id        = atq.agent_id
         WHERE atq.runtime_id IS NOT NULL
           AND (
                (tu.updated_at >= p_from AND tu.updated_at < p_to)
                OR (tu.updated_at IS NULL
                    AND tu.created_at >= p_from
                    AND tu.created_at <  p_to)
           )
    ),
    dirty_from_queue AS (
        SELECT bucket_hour, workspace_id, runtime_id, agent_id,
               provider, model
          FROM task_usage_hourly_dirty
         WHERE enqueued_at < p_to
    ),
    dirty_keys AS (
        SELECT * FROM dirty_from_updates
        UNION
        SELECT * FROM dirty_from_queue
    ),
    recomputed AS (
        SELECT
            dk.bucket_hour,
            dk.workspace_id,
            dk.runtime_id,
            dk.agent_id,
            dk.provider,
            dk.model,
            SUM(tu.input_tokens)::bigint       AS input_tokens,
            SUM(tu.output_tokens)::bigint      AS output_tokens,
            SUM(tu.cache_read_tokens)::bigint  AS cache_read_tokens,
            SUM(tu.cache_write_tokens)::bigint AS cache_write_tokens,
            COALESCE(SUM(tu.cost_usd_ticks), 0)::bigint AS cost_usd_ticks,
            COALESCE(SUM(tu.input_tokens)       FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_input_tokens,
            COALESCE(SUM(tu.output_tokens)      FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_output_tokens,
            COALESCE(SUM(tu.cache_read_tokens)  FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_read_tokens,
            COALESCE(SUM(tu.cache_write_tokens) FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_write_tokens,
            COUNT(DISTINCT tu.task_id)::bigint AS task_count,
            COUNT(*)::bigint                   AS event_count
          FROM dirty_keys dk
          JOIN agent_task_queue atq ON atq.runtime_id  = dk.runtime_id
                                    AND atq.agent_id    = dk.agent_id
          JOIN agent            a   ON a.id            = atq.agent_id
                                    AND a.workspace_id = dk.workspace_id
          JOIN task_usage       tu  ON tu.task_id      = atq.id
                                    AND tu.provider    = dk.provider
                                    AND tu.model       = dk.model
                                    AND task_usage_hour_bucket(tu.created_at) = dk.bucket_hour
         GROUP BY 1, 2, 3, 4, 5, 6
    ),
    upserted AS (
        INSERT INTO task_usage_hourly AS d (
            bucket_hour, workspace_id, runtime_id, agent_id,
            provider, model,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost_usd_ticks,
            uncosted_input_tokens, uncosted_output_tokens,
            uncosted_cache_read_tokens, uncosted_cache_write_tokens,
            task_count, event_count
        )
        SELECT
            bucket_hour, workspace_id, runtime_id, agent_id,
            provider, model,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost_usd_ticks,
            uncosted_input_tokens, uncosted_output_tokens,
            uncosted_cache_read_tokens, uncosted_cache_write_tokens,
            task_count, event_count
          FROM recomputed
        ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_key DO UPDATE
            SET input_tokens                = EXCLUDED.input_tokens,
                output_tokens               = EXCLUDED.output_tokens,
                cache_read_tokens           = EXCLUDED.cache_read_tokens,
                cache_write_tokens          = EXCLUDED.cache_write_tokens,
                cost_usd_ticks              = EXCLUDED.cost_usd_ticks,
                uncosted_input_tokens       = EXCLUDED.uncosted_input_tokens,
                uncosted_output_tokens      = EXCLUDED.uncosted_output_tokens,
                uncosted_cache_read_tokens  = EXCLUDED.uncosted_cache_read_tokens,
                uncosted_cache_write_tokens = EXCLUDED.uncosted_cache_write_tokens,
                task_count                  = EXCLUDED.task_count,
                event_count                 = EXCLUDED.event_count,
                updated_at                  = now()
        RETURNING 1
    ),
    deleted_empty AS (
        DELETE FROM task_usage_hourly d
         USING dirty_keys dk
         WHERE d.bucket_hour  = dk.bucket_hour
           AND d.workspace_id = dk.workspace_id
           AND d.runtime_id   = dk.runtime_id
           AND d.agent_id     = dk.agent_id
           AND d.provider     = dk.provider
           AND d.model        = dk.model
           AND NOT EXISTS (
               SELECT 1 FROM recomputed r
                WHERE r.bucket_hour  = dk.bucket_hour
                  AND r.workspace_id = dk.workspace_id
                  AND r.runtime_id   = dk.runtime_id
                  AND r.agent_id     = dk.agent_id
                  AND r.provider     = dk.provider
                  AND r.model        = dk.model
           )
        RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM upserted) + (SELECT COUNT(*) FROM deleted_empty)
      INTO v_rows;

    DELETE FROM task_usage_hourly_dirty WHERE enqueued_at < p_to;

    RETURN v_rows;
END;
$$;

CREATE FUNCTION task_usage_hour_bucket(ts timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT (date_trunc('hour', ts AT TIME ZONE 'UTC')) AT TIME ZONE 'UTC';
$$;

CREATE FUNCTION task_usage_hourly_rollup_lag_seconds() RETURNS double precision
    LANGUAGE sql STABLE
    AS $$
    SELECT EXTRACT(EPOCH FROM (now() - last_run_finished_at))
      FROM task_usage_hourly_rollup_state
     WHERE id = 1;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

ALTER TABLE agent_task_queue
    ADD CONSTRAINT agent_task_queue_active_requires_runtime CHECK (((runtime_id IS NOT NULL) OR (completed_at IS NOT NULL))) NOT VALID;

ALTER TABLE runtime_profile
    ADD CONSTRAINT runtime_profile_protocol_family_check CHECK ((protocol_family = ANY (ARRAY['claude'::text, 'codebuddy'::text, 'codex'::text, 'copilot'::text, 'opencode'::text, 'codearts'::text, 'openclaw'::text, 'hermes'::text, 'pi'::text, 'cursor'::text, 'kimi'::text, 'reasonix'::text, 'dsh'::text, 'kiro'::text, 'antigravity'::text, 'qoder'::text, 'qoderclicn'::text, 'traecli'::text, 'deveco'::text, 'grok'::text, 'qwen'::text, 'qwenpaw'::text, 'mcode'::text, 'dim'::text, 'zeroclaw'::text]))) NOT VALID;

CREATE TRIGGER mirror_dingtalk_group_presence_bot_identity AFTER INSERT OR UPDATE OF bot_name, bot_identity_issue ON dingtalk_group_presence FOR EACH ROW EXECUTE FUNCTION mirror_dingtalk_group_presence_bot_identity();

CREATE TRIGGER mirror_legacy_dingtalk_group_route_presence AFTER INSERT OR UPDATE ON dingtalk_group_route FOR EACH ROW EXECUTE FUNCTION mirror_legacy_dingtalk_group_route_presence();

CREATE TRIGGER trg_atq_dirty_hourly BEFORE DELETE OR UPDATE OF runtime_id, agent_id ON agent_task_queue FOR EACH ROW WHEN ((current_setting('auro.workspace_teardown'::text, true) IS DISTINCT FROM 'on'::text)) EXECUTE FUNCTION enqueue_task_usage_hourly_dirty_for_atq();

CREATE TRIGGER trg_clear_runtime_mcp_overlay BEFORE UPDATE OF status ON agent_task_queue FOR EACH ROW EXECUTE FUNCTION clear_runtime_mcp_overlay_on_terminal_state();

CREATE TRIGGER trg_enforce_channel_message_task_context_revision BEFORE UPDATE OF task_id ON chat_message FOR EACH ROW WHEN (((old.task_id IS NULL) AND (new.task_id IS NOT NULL) AND (new.role = 'user'::text))) EXECUTE FUNCTION enforce_channel_message_task_context_revision();

CREATE TRIGGER trg_tu_dirty_hourly BEFORE DELETE ON task_usage FOR EACH ROW WHEN ((current_setting('auro.workspace_teardown'::text, true) IS DISTINCT FROM 'on'::text)) EXECUTE FUNCTION enqueue_task_usage_hourly_dirty_for_tu();
