import { describe, expect, it } from "vitest";
import { AppConfigSchema, WecomInstallationSchema, ListWecomInstallationsResponseSchema, RedeemWecomBindingTokenResponseSchema, EMPTY_WECOM_INSTALLATION, EMPTY_LIST_WECOM_INSTALLATIONS_RESPONSE, EMPTY_REDEEM_WECOM_BINDING_TOKEN_RESPONSE, TelegramInstallationSchema, ListTelegramInstallationsResponseSchema, RedeemTelegramBindingTokenResponseSchema, EMPTY_TELEGRAM_INSTALLATION, EMPTY_LIST_TELEGRAM_INSTALLATIONS_RESPONSE, EMPTY_REDEEM_TELEGRAM_BINDING_TOKEN_RESPONSE, AgentTaskListSchema, AgentActivityBucketListSchema, TaskMessageListSchema, AutopilotQuotaUsageSchema, AutopilotRunSchema, FALLBACK_AUTOPILOT_RUN, DashboardAgentRunTimeListSchema, DashboardRunTimeDailyListSchema, DashboardFailureByAgentListSchema, DashboardFailureDailyListSchema, DashboardUsageByAgentListSchema, DashboardUsageDailyListSchema, ChatDraftRestoresResponseSchema, ChatPendingTaskSchema, ChatSessionListSchema, ChatSessionSchema, PrioritizeQueuedChatTaskResponseSchema, CreateFeedbackResponseSchema, EMPTY_CHAT_DRAFT_RESTORES, EMPTY_CHAT_PENDING_TASK, EMPTY_CHAT_SESSION, EMPTY_PRIORITIZE_QUEUED_CHAT_TASK_RESPONSE, EMPTY_CREATE_FEEDBACK_RESPONSE, EMPTY_INBOX_ITEMS, EMPTY_INBOX_UNREAD_SUMMARY, EMPTY_USER, InboxItemListSchema, InboxUnreadSummarySchema, MALFORMED_RUNTIME_MODEL_LIST_REQUEST, RuntimeModelListRequestSchema, RuntimeHourlyActivityListSchema, RuntimeUsageByAgentListSchema, RuntimeUsageByHourListSchema, RuntimeUsageListSchema, SendChatMessageResponseSchema, UserSchema, PluginInstallationSchema, PluginInstallationListResponseSchema, PluginMCPToolListSchema, PluginPreviewSchema, EMPTY_PLUGIN_INSTALLATION_LIST, EMPTY_PLUGIN_PREVIEW } from "./schemas";
import { parseWithFallback } from "./schema";

describe("ChatSessionSchema", () => {
  const baseSession = {
    id: "chat-1",
    workspace_id: "ws-1",
    agent_id: "agent-1",
    creator_id: "user-1",
    title: "Channel chat",
    status: "active",
    has_unread: false,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
  };

  it("accepts channel route metadata and leaves it absent for first-party Chats", () => {
    expect(ChatSessionSchema.parse(baseSession).channel_source).toBeUndefined();

    const parsed = ChatSessionSchema.parse({
      ...baseSession,
      channel_source: {
        channel_type: "slack",
        installation_id: "installation-1",
        route_revision: 3,
      },
      is_current_channel_route: false,
    });
    expect(parsed.channel_source).toEqual({
      channel_type: "slack",
      installation_id: "installation-1",
      route_revision: 3,
    });
    expect(parsed.is_current_channel_route).toBe(false);
  });

  it("degrades malformed session metadata without dropping the Chat", () => {
    const parsed = ChatSessionSchema.parse({
      ...baseSession,
      channel_source: { channel_type: 42 },
      is_current_channel_route: "yes",
    });
    expect(parsed.channel_source).toBeUndefined();
    expect(parsed.is_current_channel_route).toBeUndefined();
    expect(parsed.id).toBe("chat-1");

    expect(parseWithFallback({ id: 42 }, ChatSessionSchema, EMPTY_CHAT_SESSION, {
      endpoint: "GET /api/chat/sessions/:id",
    })).toEqual(EMPTY_CHAT_SESSION);
  });

  it("drops one malformed list item without hiding the other Chats", () => {
    const parsed = ChatSessionListSchema.parse([
      baseSession,
      { ...baseSession, id: 42 },
      {
        ...baseSession,
        id: "onboarding-chat",
        last_message: {
          content: "Welcome",
          role: "assistant",
          created_at: "2026-08-18T00:00:00Z",
          message_kind: "onboarding_opening",
        },
      },
    ]);

    expect(parsed.map((session) => session.id)).toEqual(["chat-1", "onboarding-chat"]);
    expect(parsed[1]?.last_message?.message_kind).toBe("onboarding_opening");
  });
});

describe("SourceContextPreviewSchema", () => {
});

describe("AgentTaskListSchema", () => {

  it("parses cancellation actor metadata without making it required", () => {
    const parsed = AgentTaskListSchema.parse([
      { id: "new", cancelled_by: { type: "member", id: "user-1", name: "Jiayuan" } },
      { id: "legacy" },
      { id: "malformed", cancelled_by: "member" },
    ]);

    expect(parsed[0]?.cancelled_by).toEqual({ type: "member", id: "user-1", name: "Jiayuan" });
    expect(parsed[1]?.cancelled_by).toBeUndefined();
    expect(parsed[2]?.cancelled_by).toBeUndefined();
  });

  const task = {
    id: "task-1",
    agent_id: "agent-1",
    runtime_id: "runtime-1",
    status: "queued",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "2026-07-10T00:00:00Z",
  };

  it("accepts durable workdir metadata from newer backends", () => {
    const parsed = AgentTaskListSchema.parse([
      {
        ...task,
        status: "completed",
        work_dir: "/managed/task/worktree",
        durable_work_dir: "/Users/dev/project",
        relative_durable_work_dir: "project",
        branch_name: "agent/j/abc12345",
      },
    ]);

    expect(parsed[0]).toMatchObject({
      durable_work_dir: "/Users/dev/project",
      relative_durable_work_dir: "project",
      branch_name: "agent/j/abc12345",
    });
  });

  it("degrades malformed optional path metadata without dropping task rows", () => {
    const parsed = AgentTaskListSchema.parse([
      {
        ...task,
        work_dir: 1,
        durable_work_dir: { path: "/project" },
        relative_durable_work_dir: false,
        branch_name: ["agent/j/abc12345"],
      },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.work_dir).toBeUndefined();
    expect(parsed[0]?.durable_work_dir).toBeUndefined();
    expect(parsed[0]?.relative_durable_work_dir).toBeUndefined();
    expect(parsed[0]?.branch_name).toBeUndefined();
  });
});

describe("ChatDraftRestoresResponseSchema", () => {
  it("parses a well-formed response with attachments", () => {
    const parsed = parseWithFallback(
      {
        restores: [
          {
            id: "msg-1",
            chat_session_id: "s-1",
            task_id: "t-1",
            content: "run the thing",
            attachments: [{ id: "att-1", filename: "notes.txt" }],
            created_at: "2026-07-01T00:00:00Z",
          },
        ],
      },
      ChatDraftRestoresResponseSchema,
      EMPTY_CHAT_DRAFT_RESTORES,
      { endpoint: "test" },
    );
    expect(parsed.restores).toHaveLength(1);
    expect(parsed.restores[0]?.content).toBe("run the thing");
    expect(parsed.restores[0]?.attachments?.[0]?.id).toBe("att-1");
  });

  it("defaults a missing restores array instead of crashing the composer", () => {
    const parsed = parseWithFallback(
      {},
      ChatDraftRestoresResponseSchema,
      EMPTY_CHAT_DRAFT_RESTORES,
      { endpoint: "test" },
    );
    expect(parsed.restores).toEqual([]);
  });

  it("falls back to the empty response on a malformed row", () => {
    // A row without the consume key (id) is unusable — the whole response
    // falls back and the durable rows simply stay pending server-side.
    const parsed = parseWithFallback(
      { restores: [{ chat_session_id: "s-1", content: 42 }] },
      ChatDraftRestoresResponseSchema,
      EMPTY_CHAT_DRAFT_RESTORES,
      { endpoint: "test" },
    );
    expect(parsed).toEqual(EMPTY_CHAT_DRAFT_RESTORES);
  });
});

describe("ChatPendingTaskSchema", () => {
  const ENDPOINT = { endpoint: "GET /api/chat/sessions/:id/pending-task" };

  it("keeps legacy responses compatible when queued_tasks is absent", () => {
    const parsed = parseWithFallback(
      {
        task_id: "task-active",
        status: "running",
        created_at: "2026-07-01T00:00:00Z",
      },
      ChatPendingTaskSchema,
      EMPTY_CHAT_PENDING_TASK,
      ENDPOINT,
    );

    expect(parsed).toMatchObject({
      task_id: "task-active",
      status: "running",
    });
    expect(parsed.queued_tasks).toBeUndefined();
  });

  it("parses queued task summaries", () => {
    const parsed = ChatPendingTaskSchema.parse({
      task_id: "task-active",
      status: "running",
      queued_tasks: [
        {
          task_id: "task-queued",
          status: "queued",
          content: "Follow up after the current task",
          created_at: "2026-07-01T00:01:00Z",
        },
      ],
    });

    expect(parsed.queued_tasks).toEqual([
      expect.objectContaining({
        task_id: "task-queued",
        content: "Follow up after the current task",
      }),
    ]);
  });

  it("keeps a valid head and ignores only malformed queued rows", () => {
    const parsed = parseWithFallback(
      {
        task_id: "task-active",
        queued_tasks: [{ task_id: 42, status: "queued" }],
      },
      ChatPendingTaskSchema,
      EMPTY_CHAT_PENDING_TASK,
      ENDPOINT,
    );

    expect(parsed).toEqual({
      task_id: "task-active",
      queued_tasks: [],
    });
  });
});

describe("SendChatMessageResponseSchema", () => {
  const base = {
    message_id: "message-1",
    task_id: "task-1",
    created_at: "2026-08-05T00:00:00Z",
  };

  it("parses the server-authoritative queue position", () => {
    expect(SendChatMessageResponseSchema.parse({ ...base, queued: false }).queued).toBe(false);
  });

  it("ignores a malformed additive queue position without losing the accepted send", () => {
    expect(SendChatMessageResponseSchema.parse({ ...base, queued: "no" }).queued).toBeUndefined();
  });
});

describe("PrioritizeQueuedChatTaskResponseSchema", () => {
  const ENDPOINT = {
    endpoint: "POST /api/chat/sessions/:id/queued-tasks/:taskId/prioritize",
  };

  it("parses the prioritized task id", () => {
    expect(
      PrioritizeQueuedChatTaskResponseSchema.parse({
        task_id: "task-queued",
        active_task_id: "task-active",
      }),
    ).toEqual({
      task_id: "task-queued",
      active_task_id: "task-active",
    });
  });

  it("falls back when task_id is malformed", () => {
    expect(
      parseWithFallback(
        { task_id: 42 },
        PrioritizeQueuedChatTaskResponseSchema,
        EMPTY_PRIORITIZE_QUEUED_CHAT_TASK_RESPONSE,
        ENDPOINT,
      ),
    ).toBe(EMPTY_PRIORITIZE_QUEUED_CHAT_TASK_RESPONSE);
  });
});

describe("CreateFeedbackResponseSchema", () => {
  const ENDPOINT = { endpoint: "POST /api/feedback" };

  it("parses a well-formed response and preserves extra fields", () => {
    const parsed = parseWithFallback(
      { id: "feedback-1", created_at: "2026-06-26T00:00:00Z", future_field: true },
      CreateFeedbackResponseSchema,
      EMPTY_CREATE_FEEDBACK_RESPONSE,
      ENDPOINT,
    );
    expect(parsed).toMatchObject({
      id: "feedback-1",
      created_at: "2026-06-26T00:00:00Z",
      future_field: true,
    });
  });

  it("returns the empty fallback for malformed feedback responses", () => {
    expect(
      parseWithFallback(
        { id: 123, created_at: "2026-06-26T00:00:00Z" },
        CreateFeedbackResponseSchema,
        EMPTY_CREATE_FEEDBACK_RESPONSE,
        ENDPOINT,
      ),
    ).toBe(EMPTY_CREATE_FEEDBACK_RESPONSE);
    expect(
      parseWithFallback(null, CreateFeedbackResponseSchema, EMPTY_CREATE_FEEDBACK_RESPONSE, ENDPOINT),
    ).toBe(EMPTY_CREATE_FEEDBACK_RESPONSE);
  });
});

// `user.timezone` (Viewing tz) was added in the timezone-architecture RFC.
// A desktop build older than the server — or a server predating the
// `user.timezone` migration — will return a `/api/me` body with no
// `timezone` key. The schema must not fail closed on that: the field
// defaults to `null`, which the frontend resolves to the browser-detected
// tz at render time.
describe("UserSchema timezone drift", () => {
  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Ada",
    email: "ada@example.com",
  };

  it("defaults timezone to null when the field is absent", () => {
    const parsed = UserSchema.parse(base);
    expect(parsed.timezone).toBe(null);
  });

  it("preserves an explicit IANA timezone", () => {
    const parsed = UserSchema.parse({ ...base, timezone: "Asia/Tokyo" });
    expect(parsed.timezone).toBe("Asia/Tokyo");
  });

  it("accepts an explicit null timezone", () => {
    const parsed = UserSchema.parse({ ...base, timezone: null });
    expect(parsed.timezone).toBe(null);
  });

  // Wrong-type drift: a future server bug sending `timezone` as a number
  // must not throw into the UI. parseWithFallback degrades the whole user
  // object to the explicit fallback (EMPTY_USER) so /api/me callers keep a
  // valid shape instead of white-screening.
  it("falls back to EMPTY_USER when timezone is the wrong type", () => {
    const parsed = parseWithFallback(
      { ...base, timezone: 42 },
      UserSchema,
      EMPTY_USER,
      { endpoint: "GET /api/me" },
    );
    expect(parsed).toBe(EMPTY_USER);
  });
});

// The workspace dashboard and runtime-detail pages were re-pointed at the
// unified `task_usage_hourly` rollup. Every numeric field drives chart /
// KPI math, and string keys (date / agent_id / model) bucket the series.
// The contract these schemas must hold: a row missing a field degrades
// that field to a sane default rather than dropping the WHOLE array to
// the `[]` fallback — one drifted row must not blank the entire chart.
describe("dashboard + runtime usage schema drift", () => {
  it("coerces a missing numeric field to 0 instead of dropping the array", () => {
    const parsed = DashboardUsageDailyListSchema.parse([
      { date: "2026-05-19", model: "claude-opus-4-7", input_tokens: 100 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.output_tokens).toBe(0);
    expect(parsed[0]?.cache_read_tokens).toBe(0);
    expect(parsed[0]?.cache_write_tokens).toBe(0);
  });

  it("coerces a missing date key to \"\" so the rest of the series survives", () => {
    const parsed = DashboardUsageDailyListSchema.parse([
      { model: "claude-opus-4-7", input_tokens: 5 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.date).toBe("");
  });

  it("coerces a missing agent_id key to \"\" for the agent-runtime panel", () => {
    const parsed = DashboardAgentRunTimeListSchema.parse([
      { total_seconds: 42, task_count: 3, failed_count: 0 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.agent_id).toBe("");
  });

  it("defaults a missing cancelled_count to 0 so a pre-cancelled-count server still renders", () => {
    // cancelled_count was added when the run-time rollups started counting
    // runs the user stopped mid-flight. A backend predating it omits the
    // field; the row must survive with a 0 segment rather than drop the
    // whole series (installed desktop clients hit older backends).
    expect(
      DashboardAgentRunTimeListSchema.parse([
        { agent_id: "a", total_seconds: 42, task_count: 3, failed_count: 0 },
      ])[0]?.cancelled_count,
    ).toBe(0);
    expect(
      DashboardRunTimeDailyListSchema.parse([
        { date: "2026-05-19", total_seconds: 42, task_count: 3, failed_count: 0 },
      ])[0]?.cancelled_count,
    ).toBe(0);
  });

  it("preserves optional usage coverage without rejecting older or malformed rows", () => {
    const parsed = DashboardAgentRunTimeListSchema.parse([
      {
        agent_id: "new-server",
        total_seconds: 42,
        task_count: 3,
        metered_task_count: 2,
        failed_count: 0,
      },
      {
        agent_id: "old-server",
        total_seconds: 42,
        task_count: 3,
        failed_count: 0,
      },
      {
        agent_id: "drifted-server",
        total_seconds: 42,
        task_count: 3,
        metered_task_count: "not-a-number",
        failed_count: 0,
      },
    ]);
    expect(parsed[0]?.metered_task_count).toBe(2);
    expect(parsed[1]?.metered_task_count).toBeUndefined();
    expect(parsed[2]?.metered_task_count).toBeUndefined();
  });

  it("coerces a missing agent_id key to \"\" for the usage-by-agent panel", () => {
    const parsed = DashboardUsageByAgentListSchema.parse([
      { model: "claude-opus-4-7", input_tokens: 7 },
    ]);
    expect(parsed[0]?.agent_id).toBe("");
  });

  it("coerces missing fields on every runtime usage schema", () => {
    expect(RuntimeUsageListSchema.parse([{ date: "2026-05-19" }])[0]?.input_tokens).toBe(0);
    expect(RuntimeHourlyActivityListSchema.parse([{ hour: 9 }])[0]?.count).toBe(0);
    expect(RuntimeUsageByAgentListSchema.parse([{ model: "x" }])[0]?.agent_id).toBe("");
    expect(RuntimeUsageByHourListSchema.parse([{ hour: 9 }])[0]?.model).toBe("");
  });

  it("defaults a missing provider to \"\" so an older server's rows still price by bare model", () => {
    // provider was added for cross-provider model disambiguation; a server
    // predating it omits the field. The schema must fill "" (→ bare-model
    // pricing lookup) rather than drop the row.
    expect(
      DashboardUsageDailyListSchema.parse([{ date: "2026-05-19", model: "claude-opus-4-7" }])[0]
        ?.provider,
    ).toBe("");
    expect(
      DashboardUsageByAgentListSchema.parse([{ model: "claude-opus-4-7" }])[0]?.provider,
    ).toBe("");
    expect(RuntimeUsageByAgentListSchema.parse([{ model: "x" }])[0]?.provider).toBe("");
  });

  it("rejects a non-array body so parseWithFallback can return its fallback", () => {
    expect(DashboardUsageDailyListSchema.safeParse(null).success).toBe(false);
    expect(DashboardFailureDailyListSchema.safeParse(null).success).toBe(false);
    expect(DashboardFailureByAgentListSchema.safeParse({ rows: [] }).success).toBe(
      false,
    );
    expect(RuntimeUsageListSchema.safeParse({ rows: [] }).success).toBe(false);
  });

  it("keeps a failure_reason the client build has never heard of", () => {
    // failure_reason is an open string, not an enum: the backend taxonomy
    // grows, and an installed desktop client must still count a reason its
    // build predates rather than dropping the row (and with it the day's
    // error total).
    const parsed = DashboardFailureDailyListSchema.parse([
      { date: "2026-05-19", failure_reason: "agent_error.brand_new", task_count: 3 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.failure_reason).toBe("agent_error.brand_new");
    expect(parsed[0]?.task_count).toBe(3);
  });

  it("coerces a missing failure row field without dropping the array", () => {
    const daily = DashboardFailureDailyListSchema.parse([{ date: "2026-05-19" }]);
    expect(daily).toHaveLength(1);
    // "" is the succeeded bucket, so a reason-less row lands in the
    // denominator instead of inventing a failure that never happened.
    //
    // Defaulting to a failure bucket instead was considered and rejected: the
    // realistic drift here is someone adding `omitempty` to the Go struct
    // tag, which would strip the field from exactly the SUCCESS rows and turn
    // every window into a 100% error rate. Deflating a rate under drift is
    // the milder failure. TestDashboardFailureWireContractKeepsEmptyReason
    // (server/internal/handler/dashboard_test.go) guards the other side by
    // pinning that the server always emits the field.
    expect(daily[0]?.failure_reason).toBe("");
    expect(daily[0]?.task_count).toBe(0);

    const byAgent = DashboardFailureByAgentListSchema.parse([
      { failure_reason: "timeout", task_count: 2 },
    ]);
    expect(byAgent[0]?.agent_id).toBe("");
  });

  it("keeps unknown server-side fields via .loose()", () => {
    const parsed = RuntimeUsageListSchema.parse([
      { date: "2026-05-19", region: "us-east" },
    ]);
    expect((parsed[0] as Record<string, unknown>).region).toBe("us-east");
  });
});

describe("AppConfigSchema local_worktree_supported drift", () => {
  it("defaults to false when the server predates the signal", () => {
    const parsed = AppConfigSchema.parse({ cdn_domain: "cdn.example.com" });
    expect(parsed.local_worktree_supported).toBe(false);
  });

  it("coerces a malformed value to false rather than trusting it", () => {
    const parsed = AppConfigSchema.parse({
      cdn_domain: "cdn.example.com",
      local_worktree_supported: "yes",
    });
    expect(parsed.local_worktree_supported).toBe(false);
  });

  it("carries a genuine true through", () => {
    const parsed = AppConfigSchema.parse({
      cdn_domain: "cdn.example.com",
      local_worktree_supported: true,
    });
    expect(parsed.local_worktree_supported).toBe(true);
  });
});

describe("AppConfigSchema agent_conversation_starters_supported drift", () => {
  it("defaults to false when the server predates the persistence contract", () => {
    expect(AppConfigSchema.parse({}).agent_conversation_starters_supported).toBe(false);
  });

  it("coerces a malformed declaration to false", () => {
    expect(
      AppConfigSchema.parse({ agent_conversation_starters_supported: "yes" })
        .agent_conversation_starters_supported,
    ).toBe(false);
  });

  it("carries a genuine declaration through", () => {
    expect(
      AppConfigSchema.parse({ agent_conversation_starters_supported: true })
        .agent_conversation_starters_supported,
    ).toBe(true);
  });
});

describe("AppConfigSchema cdn_signed drift", () => {
  it("defaults cdn_signed to false when the server omits it (pre-MUL-3254 servers)", () => {
    const parsed = AppConfigSchema.parse({ cdn_domain: "cdn.example.com" });
    expect(parsed.cdn_signed).toBe(false);
  });

  it("coerces a malformed cdn_signed to false instead of failing the whole config", () => {
    const parsed = AppConfigSchema.parse({
      cdn_domain: "cdn.example.com",
      cdn_signed: "yes",
    });
    expect(parsed.cdn_signed).toBe(false);
    expect(parsed.cdn_domain).toBe("cdn.example.com");
  });

  it("keeps cdn_signed=true from a signing-enabled server", () => {
    const parsed = AppConfigSchema.parse({ cdn_signed: true });
    expect(parsed.cdn_signed).toBe(true);
  });

  it("parses frontend feature flag decisions", () => {
    const parsed = AppConfigSchema.parse({
      feature_flags: {
        composio_mcp_apps: true,
        malformed_future_flag: "yes",
      },
    });
    expect(parsed.feature_flags).toEqual({
      composio_mcp_apps: true,
      malformed_future_flag: false,
    });
  });

  it("defaults malformed feature_flags to an empty object", () => {
    const parsed = AppConfigSchema.parse({ feature_flags: ["not", "an", "object"] });
    expect(parsed.feature_flags).toEqual({});
  });

  it("parses server_version and leaves it undefined when the server omits it", () => {
    expect(AppConfigSchema.parse({ server_version: "1.2.3" }).server_version).toBe("1.2.3");
    expect(AppConfigSchema.parse({}).server_version).toBeUndefined();
  });
});

describe("InboxUnreadSummarySchema", () => {
  const ENDPOINT = { endpoint: "GET /api/inbox/unread-summary" };

  it("parses a well-formed summary and tolerates extra fields", () => {
    const parsed = parseWithFallback(
      [
        { workspace_id: "ws-1", count: 2 },
        { workspace_id: "ws-2", count: 0, future_field: "ignored" },
      ],
      InboxUnreadSummarySchema,
      EMPTY_INBOX_UNREAD_SUMMARY,
      ENDPOINT,
    );
    expect(parsed).toEqual([
      { workspace_id: "ws-1", count: 2 },
      { workspace_id: "ws-2", count: 0, future_field: "ignored" },
    ]);
  });

  it("returns the empty fallback (dot hidden) for a non-array body", () => {
    expect(
      parseWithFallback({ rows: [] }, InboxUnreadSummarySchema, EMPTY_INBOX_UNREAD_SUMMARY, ENDPOINT),
    ).toBe(EMPTY_INBOX_UNREAD_SUMMARY);
    expect(
      parseWithFallback(null, InboxUnreadSummarySchema, EMPTY_INBOX_UNREAD_SUMMARY, ENDPOINT),
    ).toBe(EMPTY_INBOX_UNREAD_SUMMARY);
  });

  it("returns the empty fallback when an entry has a wrong-typed count", () => {
    expect(
      parseWithFallback(
        [{ workspace_id: "ws-1", count: "lots" }],
        InboxUnreadSummarySchema,
        EMPTY_INBOX_UNREAD_SUMMARY,
        ENDPOINT,
      ),
    ).toBe(EMPTY_INBOX_UNREAD_SUMMARY);
  });
});

describe("InboxItemListSchema", () => {
  const ENDPOINT = { endpoint: "GET /api/inbox/archived" };

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "inbox-1",
    workspace_id: "ws-1",
    recipient_type: "member",
    recipient_id: "member-1",
    type: "new_comment",
    severity: "info",
    title: "Issue title",
    body: null,
    read: false,
    archived: true,
    created_at: "2026-06-15T08:00:00Z",
    ...overrides,
  });

  it("parses a well-formed archived list and tolerates extra fields", () => {
    const parsed = parseWithFallback(
      [row({
        details: { comment_id: "c-1" },
        future_field: 1,
      })],
      InboxItemListSchema,
      EMPTY_INBOX_ITEMS,
      ENDPOINT,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "inbox-1",
      archived: true,
    });
  });

  it("keeps a notification type this client doesn't know yet", () => {
    // Enums stay lenient on purpose: a backend that ships a new inbox type
    // must not blank the whole archived list on older clients.
    const parsed = parseWithFallback(
      [row({ type: "some_future_type", severity: "future_severity" })],
      InboxItemListSchema,
      EMPTY_INBOX_ITEMS,
      ENDPOINT,
    );
    expect(parsed).toHaveLength(1);
  });

  it("accepts rows that omit the nullable optional fields", () => {
    const { body, ...withoutOptionals } = row();
    void body;
    expect(
      parseWithFallback([withoutOptionals], InboxItemListSchema, EMPTY_INBOX_ITEMS, ENDPOINT),
    ).toHaveLength(1);
  });

  it("returns the empty fallback for a non-array body", () => {
    expect(
      parseWithFallback({ items: [] }, InboxItemListSchema, EMPTY_INBOX_ITEMS, ENDPOINT),
    ).toBe(EMPTY_INBOX_ITEMS);
    expect(
      parseWithFallback(null, InboxItemListSchema, EMPTY_INBOX_ITEMS, ENDPOINT),
    ).toBe(EMPTY_INBOX_ITEMS);
  });

  it("returns the empty fallback when a row is missing a required field", () => {
    const { id, ...withoutId } = row();
    void id;
    expect(
      parseWithFallback([withoutId], InboxItemListSchema, EMPTY_INBOX_ITEMS, ENDPOINT),
    ).toBe(EMPTY_INBOX_ITEMS);
  });

  it("returns the empty fallback when `archived` is wrong-typed", () => {
    expect(
      parseWithFallback(
        [row({ archived: "yes" })],
        InboxItemListSchema,
        EMPTY_INBOX_ITEMS,
        ENDPOINT,
      ),
    ).toBe(EMPTY_INBOX_ITEMS);
  });
});

// The "run now" flow branches on run.status/reason_code to avoid a false-success
// toast (MUL-4525), so the trigger response must survive backend drift.
describe("AutopilotRunSchema", () => {
  const ENDPOINT = { endpoint: "POST /api/autopilots/:id/trigger" };
  const baseRun = {
    id: "run-1",
    autopilot_id: "ap-1",
    trigger_id: null,
    source: "manual",
    status: "issue_created",
    task_id: null,
    triggered_at: "2026-07-14T00:00:00Z",
    completed_at: null,
    failure_reason: null,
    trigger_payload: null,
    result: null,
    created_at: "2026-07-14T00:00:00Z",
  };

  it("preserves a blocked run's status and reason_code", () => {
    const parsed = parseWithFallback(
      { ...baseRun, status: "skipped", failure_reason: "you are not allowed to trigger this autopilot's assignee agent", reason_code: "invocation_not_allowed" },
      AutopilotRunSchema,
      FALLBACK_AUTOPILOT_RUN,
      ENDPOINT,
    );
    expect(parsed.status).toBe("skipped");
    expect(parsed.reason_code).toBe("invocation_not_allowed");
  });

  it("tolerates an older server omitting reason_code", () => {
    const parsed = parseWithFallback(baseRun, AutopilotRunSchema, FALLBACK_AUTOPILOT_RUN, ENDPOINT);
    expect(parsed.status).toBe("issue_created");
    expect(parsed.reason_code).toBeUndefined();
  });

  it("degrades a malformed response to a non-success fallback (never a false success)", () => {
    const parsed = parseWithFallback("not-an-object", AutopilotRunSchema, FALLBACK_AUTOPILOT_RUN, ENDPOINT);
    expect(parsed).toBe(FALLBACK_AUTOPILOT_RUN);
    expect(parsed.status).toBe("failed");
  });
});

describe("AutopilotQuotaUsageSchema", () => {
  const baseUsage = {
    action: "enforce",
    used: 12,
    reserved: 2,
    limit: 100,
    period_start: "2026-08-01T00:00:00Z",
    period_end: "2026-09-01T00:00:00Z",
    reset_at: "2026-09-01T00:00:00Z",
  };

  it("preserves durable blocked counts by execution source", () => {
    const parsed = AutopilotQuotaUsageSchema.parse({
      ...baseUsage,
      blocked_counts: { schedule: 3, webhook: 7 },
    });
    expect(parsed.blocked_counts).toEqual({ schedule: 3, webhook: 7 });
  });

  it("defaults blocked_counts to null for an older server", () => {
    expect(AutopilotQuotaUsageSchema.parse(baseUsage).blocked_counts).toBeNull();
  });

  it("isolates a malformed blocked_counts field", () => {
    const parsed = AutopilotQuotaUsageSchema.parse({
      ...baseUsage,
      blocked_counts: { webhook: "many" },
    });
    expect(parsed.used).toBe(12);
    expect(parsed.blocked_counts).toBeNull();
  });
});

describe("RuntimeModelListRequestSchema", () => {
  const completed = {
    id: "req-1",
    runtime_id: "rt-1",
    status: "completed",
    supported: true,
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:01Z",
    models: [
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6-Sol",
        provider: "openai",
        default: true,
        thinking: {
          supported_levels: [{ value: "high", label: "High" }],
          default_level: "low",
        },
        service_tiers: [{ id: "fast", name: "Fast" }],
        supports_explicit_standard_service_tier: true,
      },
    ],
  };

  it("parses a live completed discovery, keeping the fields the UI branches on", () => {
    const parsed = parseWithFallback(
      completed,
      RuntimeModelListRequestSchema,
      MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
      { endpoint: "test" },
    );
    expect(parsed.status).toBe("completed");
    expect(parsed.supported).toBe(true);
    expect(parsed.models?.[0]?.default).toBe(true);
    expect(parsed.models?.[0]?.thinking?.supported_levels).toEqual([
      { value: "high", label: "High" },
    ]);
    expect(parsed.models?.[0]?.service_tiers).toEqual([{ id: "fast", name: "Fast" }]);
    expect(
      parsed.models?.[0]?.supports_explicit_standard_service_tier,
    ).toBe(true);
    expect(parsed.cached).toBeUndefined();
  });

  it("keeps the additive cache markers when the server serves a snapshot", () => {
    const parsed = parseWithFallback(
      { ...completed, cached: true, cached_at: "2026-07-29T00:00:00Z" },
      RuntimeModelListRequestSchema,
      MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
      { endpoint: "test" },
    );
    expect(parsed.cached).toBe(true);
    expect(parsed.cached_at).toBe("2026-07-29T00:00:00Z");
  });

  // A backend that predates MUL-5444 sends neither marker; an even older one
  // may omit `supported`. Both must stay usable rather than reading as
  // "runtime manages the model itself" off an undefined.
  it("defaults supported to true on an older backend that omits it", () => {
    const { supported: _omitted, ...withoutSupported } = completed;
    const parsed = parseWithFallback(
      withoutSupported,
      RuntimeModelListRequestSchema,
      MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
      { endpoint: "test" },
    );
    expect(parsed.supported).toBe(true);
    expect(parsed.cached).toBeUndefined();
  });

  // MUL-6961: models the runtime cannot run arrive in their OWN list. The
  // separation is the compatibility contract — a client that never learned the
  // field reads `models` and therefore cannot offer one — so the schema must
  // keep them apart rather than folding them together.
  it("parses unavailable models without letting them into the selectable list", () => {
    const parsed = parseWithFallback(
      {
        ...completed,
        unavailable_models: [
          {
            id: "cc-update-required-1",
            label: "Fable 5.1 (disabled)",
            reason: "Update to 2.1.255+ to use Fable 5.1",
          },
        ],
      },
      RuntimeModelListRequestSchema,
      MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
      { endpoint: "test" },
    );
    expect(parsed.unavailable_models?.[0]?.id).toBe("cc-update-required-1");
    expect(parsed.unavailable_models?.[0]?.reason).toBe(
      "Update to 2.1.255+ to use Fable 5.1",
    );
    expect(parsed.models?.map((m) => m.id)).not.toContain(
      "cc-update-required-1",
    );
  });

  // An older daemon or server sends no such key. The picker then shows no
  // unavailable section, which is exactly the pre-MUL-6961 behaviour.
  it("tolerates a backend that omits unavailable models entirely", () => {
    const parsed = parseWithFallback(
      completed,
      RuntimeModelListRequestSchema,
      MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
      { endpoint: "test" },
    );
    expect(parsed.unavailable_models).toBeUndefined();
    expect(parsed.models?.length).toBe(1);
  });

  it("treats an older daemon that omits explicit-standard support as unsupported", () => {
    const model = completed.models[0]!;
    const {
      supports_explicit_standard_service_tier: _omitted,
      ...oldDaemonModel
    } = model;
    const parsed = parseWithFallback(
      { ...completed, models: [oldDaemonModel] },
      RuntimeModelListRequestSchema,
      MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
      { endpoint: "test" },
    );

    expect(
      parsed.models?.[0]?.supports_explicit_standard_service_tier,
    ).toBeUndefined();
  });

  it("passes an unknown status through instead of failing the whole response", () => {
    const parsed = parseWithFallback(
      { ...completed, status: "superseded" },
      RuntimeModelListRequestSchema,
      MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
      { endpoint: "test" },
    );
    expect(parsed.status).toBe("superseded");
  });

  // Malformed bodies must land on the "failed" fallback: `completed` would
  // fabricate an empty catalog and `pending` would spin the picker until the
  // client-side poll timeout.
  it("falls back to an explicit failure on a malformed body", () => {
    for (const malformed of [
      null,
      "nope",
      42,
      {},
      { status: 7 },
      { ...completed, status: undefined },
      { ...completed, supported: "yes" },
      { ...completed, models: "nope" },
      { ...completed, models: [{ label: "no id" }] },
      {
        ...completed,
        models: [
          {
            ...completed.models[0],
            supports_explicit_standard_service_tier: "yes",
          },
        ],
      },
    ]) {
      const parsed = parseWithFallback(
        malformed,
        RuntimeModelListRequestSchema,
        MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
        { endpoint: "test" },
      );
      expect(parsed.status).toBe("failed");
      expect(parsed.supported).toBe(true);
      expect(parsed.error).toBe("invalid model discovery response");
    }
  });

  it("keeps unknown server fields instead of stripping them", () => {
    const parsed = parseWithFallback(
      { ...completed, future_field: "keep me" },
      RuntimeModelListRequestSchema,
      MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
      { endpoint: "test" },
    );
    expect((parsed as unknown as { future_field?: string }).future_field).toBe(
      "keep me",
    );
  });
});

// WeCom smart-bot installation schemas. These gate UI affordances (the Connect
// dialog, the "ask your operator" state, the revoked-vs-active badge), so a
// malformed response must degrade to the safe state rather than a broken one.
describe("WeCom installation schemas", () => {
  it("parses a well-formed installation", () => {
    const parsed = WecomInstallationSchema.parse({
      id: "i1",
      workspace_id: "w1",
      agent_id: "a1",
      bot_id: "aibot_xyz",
      installer_user_id: "u1",
      status: "active",
    });
    expect(parsed.bot_id).toBe("aibot_xyz");
    expect(parsed.status).toBe("active");
  });

  it("defaults a missing status to 'revoked', never 'active'", () => {
    // A broken read must not render a bot as connected when it may not be.
    const parsed = WecomInstallationSchema.parse({ id: "i1" });
    expect(parsed.status).toBe("revoked");
    expect(parsed.bot_id).toBe("");
  });

  it("keeps unknown forward-compat fields (loose) instead of failing the parse", () => {
    const parsed = WecomInstallationSchema.parse({ id: "i1", future_field: "keep" });
    expect((parsed as unknown as { future_field?: string }).future_field).toBe("keep");
  });

  it("defaults 'configured' to false so a malformed list renders the operator state", () => {
    const parsed = ListWecomInstallationsResponseSchema.parse({});
    expect(parsed.configured).toBe(false);
    expect(parsed.installations).toEqual([]);
  });

  it("falls back to the empty list when the response is not an object", () => {
    const parsed = parseWithFallback(
      "not json",
      ListWecomInstallationsResponseSchema,
      EMPTY_LIST_WECOM_INSTALLATIONS_RESPONSE,
      { endpoint: "GET /api/workspaces/:id/wecom/installations" },
    );
    expect(parsed).toEqual(EMPTY_LIST_WECOM_INSTALLATIONS_RESPONSE);
    expect(parsed.configured).toBe(false);
  });

  it("falls back on a malformed installation and redeem response", () => {
    const inst = parseWithFallback(42, WecomInstallationSchema, EMPTY_WECOM_INSTALLATION, {
      endpoint: "POST /api/workspaces/:id/wecom/install/byo",
    });
    expect(inst).toEqual(EMPTY_WECOM_INSTALLATION);

    const redeem = parseWithFallback(
      null,
      RedeemWecomBindingTokenResponseSchema,
      EMPTY_REDEEM_WECOM_BINDING_TOKEN_RESPONSE,
      { endpoint: "POST /api/wecom/binding/redeem" },
    );
    expect(redeem).toEqual(EMPTY_REDEEM_WECOM_BINDING_TOKEN_RESPONSE);
  });
});

// Telegram drives the same connect/disabled/revoked UI decisions as WeCom.
// Keep its wire-contract fallbacks explicit so malformed or older responses
// cannot render a bot as connected or report a binding success.
describe("Telegram installation schemas", () => {
  it("parses a well-formed installation", () => {
    const parsed = TelegramInstallationSchema.parse({
      id: "i1",
      workspace_id: "w1",
      agent_id: "a1",
      bot_id: "12345",
      bot_username: "auro_test_bot",
      installer_user_id: "u1",
      status: "active",
    });
    expect(parsed.bot_username).toBe("auro_test_bot");
    expect(parsed.status).toBe("active");
  });

  it("defaults incomplete data to the disconnected state", () => {
    const parsed = TelegramInstallationSchema.parse({ id: "i1" });
    expect(parsed.status).toBe("revoked");
    expect(parsed.bot_id).toBe("");
    expect(parsed.bot_username).toBe("");

    const list = ListTelegramInstallationsResponseSchema.parse({});
    expect(list).toEqual({ installations: [], configured: false });
  });

  it("keeps unknown forward-compatible installation fields", () => {
    const parsed = TelegramInstallationSchema.parse({ id: "i1", future_field: "keep" });
    expect((parsed as unknown as { future_field?: string }).future_field).toBe("keep");
  });

  it("falls back safely for malformed list, install, and redeem responses", () => {
    expect(
      parseWithFallback(
        "not json",
        ListTelegramInstallationsResponseSchema,
        EMPTY_LIST_TELEGRAM_INSTALLATIONS_RESPONSE,
        { endpoint: "GET /api/workspaces/:id/telegram/installations" },
      ),
    ).toEqual(EMPTY_LIST_TELEGRAM_INSTALLATIONS_RESPONSE);

    expect(
      parseWithFallback(42, TelegramInstallationSchema, EMPTY_TELEGRAM_INSTALLATION, {
        endpoint: "POST /api/workspaces/:id/telegram/install",
      }),
    ).toEqual(EMPTY_TELEGRAM_INSTALLATION);

    expect(
      parseWithFallback(
        null,
        RedeemTelegramBindingTokenResponseSchema,
        EMPTY_REDEEM_TELEGRAM_BINDING_TOKEN_RESPONSE,
        { endpoint: "POST /api/telegram/binding/redeem" },
      ),
    ).toEqual(EMPTY_REDEEM_TELEGRAM_BINDING_TOKEN_RESPONSE);
  });
});

describe("Plugin schemas", () => {
  it("defaults every missing installation field to an inert, disabled shape", () => {
    const parsed = PluginInstallationSchema.parse({ id: "installation-1" });
    expect(parsed.enabled).toBe(false);
    expect(parsed.granted_scopes).toEqual([]);
    expect(parsed.config_schema).toEqual([]);
    expect(parsed.configured_secrets).toEqual([]);
    expect(parsed.surfaces).toEqual([]);
    expect(parsed.hooks).toEqual([]);
    expect(parsed.resources).toEqual([]);
  });

  it("does not model a secret value even when the server sends one", () => {
    // The API contract is that a secret is write-only. If a future response
    // ever regressed and echoed one, the client must not carry it into typed
    // state where a component could render it.
    const parsed = PluginInstallationSchema.parse({
      id: "installation-1",
      config: { repo: "auro-ai/auro" },
      configured_secrets: ["token"],
    });
    expect(parsed.config).toEqual({ repo: "auro-ai/auro" });
    expect(parsed.configured_secrets).toEqual(["token"]);
    expect(Object.keys(parsed)).not.toContain("secrets");
  });

  it("keeps config field declaration order so the generated form is stable", () => {
    const parsed = PluginInstallationSchema.parse({
      id: "installation-1",
      config_schema: [
        { key: "repo", type: "string", label: "Repo", required: true },
        { key: "token", type: "secret", label: "Token" },
      ],
    });
    expect(parsed.config_schema.map((field) => field.key)).toEqual(["repo", "token"]);
    expect(parsed.config_schema[1]?.required).toBe(false);
  });

  it("degrades a malformed installation list to empty rather than a partial list", () => {
    const parsed = parseWithFallback("not-json", PluginInstallationListResponseSchema, EMPTY_PLUGIN_INSTALLATION_LIST, {
      endpoint: "GET /api/workspaces/{id}/plugins",
    });
    expect(parsed).toEqual(EMPTY_PLUGIN_INSTALLATION_LIST);
  });

  it("degrades a malformed preview so the consent screen cannot show a blank scope list as approval", () => {
    const parsed = parseWithFallback({ scopes: "execution:read" }, PluginPreviewSchema, EMPTY_PLUGIN_PREVIEW, {
      endpoint: "POST /api/workspaces/{id}/plugins/preview",
    });
    expect(parsed).toEqual(EMPTY_PLUGIN_PREVIEW);
    expect(parsed.scopes).toEqual([]);
  });

  it("degrades a malformed MCP tool list to empty rather than showing tools as approved", () => {
    const parsed = parseWithFallback({ tools: "search" }, PluginMCPToolListSchema, { tools: [] }, {
      endpoint: "GET /api/workspaces/{id}/plugins/{installationId}/mcp/{hookKey}/tools",
    });
    expect(parsed.tools).toEqual([]);
  });

  // The dangerous direction is one-sided: a response missing `approved` must
  // read as NOT approved. The opposite default would render an unpinned tool
  // with a checked box, and the administrator's next save would pin it.
  it("treats a tool with no approval field as unapproved", () => {
    const parsed = PluginMCPToolListSchema.parse({ tools: [{ name: "search" }] });
    expect(parsed.tools[0]?.approved).toBe(false);
    expect(parsed.tools[0]?.drifted).toBe(false);
  });

  it("parses a preview that reports an upgrade adding new scopes", () => {
    const parsed = PluginPreviewSchema.parse({
      manifest: { key: "com.example.hello", name: "Hello", version: "2.0.0", author: { name: "example" } },
      scopes: ["execution:read", "comments:write"],
      installed: true,
      installed_version: "1.0.0",
      added_scopes: ["comments:write"],
    });
    expect(parsed.installed).toBe(true);
    expect(parsed.installed_version).toBe("1.0.0");
    expect(parsed.added_scopes).toEqual(["comments:write"]);
  });

  it("preserves automatic schedules on both consent and installed Plugin payloads", () => {
    const schedule = { cron: "*/5 * * * *", timezone: "Asia/Shanghai" };
    const preview = PluginPreviewSchema.parse({
      manifest: {
        key: "com.example.digest",
        name: "Digest",
        version: "1.0.0",
        author: { name: "example" },
        contributes: {
          hooks: [{ key: "digest", name: "Digest", triggers: ["schedule"], schedule }],
        },
      },
    });
    expect(preview.manifest.contributes?.hooks?.[0]?.schedule).toEqual(schedule);

    const installation = PluginInstallationSchema.parse({
      id: "installation-1",
      hooks: [{
        key: "digest",
        name: "Digest",
        triggers: ["schedule"],
        schedule: { ...schedule, next_run_at: "2026-08-23T10:15:00Z" },
      }],
    });
    expect(installation.hooks[0]?.schedule?.next_run_at).toBe("2026-08-23T10:15:00Z");
  });
});

describe("TaskMessageListSchema", () => {
  it("preserves call IDs and tolerates old or malformed optional identity", () => {
    const base = { task_id: "task-1", seq: 1, type: "tool_result", output: "ok" };
    const parsed = parseWithFallback<{ call_id?: string; output?: string }[]>(
      [
        { ...base, call_id: "execution:A" },
        base,
        { ...base, call_id: null },
        { ...base, call_id: 42 },
        { ...base, call_id: {} },
      ],
      TaskMessageListSchema, [], { endpoint: "GET /api/tasks/:id/messages" },
    );
    expect(parsed).toHaveLength(5);
    expect(parsed.map((m) => m.call_id)).toEqual(["execution:A", undefined, undefined, undefined, undefined]);
    expect(parsed.every((m) => m.output === "ok")).toBe(true);
  });

  const row = { task_id: "task-1", seq: 1, type: "tool_result", output: "log line" };

  // The whole point of the field: a server that never sends it is saying
  // "nobody measured this", and only `undefined` can carry that. A default of
  // false would make every historical row assert it is complete.
  it("leaves a missing truncation flag undefined rather than false", () => {
    const parsed = TaskMessageListSchema.parse([row]);
    expect(parsed[0]).not.toHaveProperty("output_truncated", false);
    expect(parsed[0]?.output_truncated).toBeUndefined();
  });

  it("keeps both measured values", () => {
    const parsed = TaskMessageListSchema.parse([
      { ...row, seq: 1, output_truncated: true },
      { ...row, seq: 2, output_truncated: false },
    ]);
    expect(parsed.map((m) => m.output_truncated)).toEqual([true, false]);
  });

  // Drift defense. Without a field-level catch, one bad boolean fails its row,
  // the array fails with it, and parseWithFallback hands the viewer an empty
  // transcript — a malformed flag would delete the whole run from the screen.
  // Degrading the field to "unknown" is the correct loss.
  it("keeps the record and forgets the field when the flag is malformed", () => {
    const parsed = parseWithFallback<{ output?: string; output_truncated?: boolean }[]>(
      [{ ...row, output_truncated: "false" }],
      TaskMessageListSchema,
      [],
      { endpoint: "GET /api/tasks/:id/messages" },
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.output).toBe("log line");
    expect(parsed[0]?.output_truncated).toBeUndefined();
  });

  it("keeps the surrounding rows when one row's flag is malformed", () => {
    const parsed = TaskMessageListSchema.parse([
      { ...row, seq: 1, output_truncated: true },
      { ...row, seq: 2, output_truncated: 12345 },
      { ...row, seq: 3, output_truncated: false },
    ]);
    expect(parsed.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(parsed.map((m) => m.output_truncated)).toEqual([true, undefined, false]);
  });

  it("falls back to an empty transcript when the response is not a list", () => {
    const parsed = parseWithFallback(
      { messages: "nope" },
      TaskMessageListSchema,
      [],
      { endpoint: "GET /api/tasks/:id/messages" },
    );
    expect(parsed).toEqual([]);
  });

  it("downgrades an unknown message type instead of dropping the transcript", () => {
    const parsed = TaskMessageListSchema.parse([{ ...row, type: "video" }]);
    expect(parsed[0]?.type).toBe("text");
  });
});


describe("AgentActivityBucketListSchema duration", () => {
  const bucket = { agent_id: "a", bucket_at: "2026-09-24T00:00:00Z", task_count: 201,
    completed_count: 201, failed_count: 0, cancelled_count: 0 };
  it("accepts optional aggregate duration from new and old servers", () => {
    expect(AgentActivityBucketListSchema.parse([bucket])[0]?.duration_ms).toBeUndefined();
    expect(AgentActivityBucketListSchema.parse([{ ...bucket, duration_ms: 12600000, duration_count: 201 }])[0]?.duration_count).toBe(201);
  });
  it("does not discard activity counts when duration is malformed", () => {
    const parsed = AgentActivityBucketListSchema.parse([{ ...bucket, duration_ms: "slow", duration_count: -1 }]);
    expect(parsed[0]?.task_count).toBe(201);
    expect(parsed[0]?.duration_ms).toBeUndefined();
    expect(parsed[0]?.duration_count).toBeUndefined();
  });
});
