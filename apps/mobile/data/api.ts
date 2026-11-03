/**
 * Mobile-owned fetch wrapper. Mirrors the surface area of
 * packages/core/api/client.ts that mobile actually uses, but lives in
 * apps/mobile/ so we control retry/timeout/error handling independently.
 *
 * Types are imported via `import type` from @auro/core/types — zero
 * runtime coupling. Zod schemas + fallbacks are imported from
 * @auro/core/api/schemas (pure data, on the mobile sharing whitelist).
 *
 * Design checklist (apps/mobile/CLAUDE.md "Lessons → ApiClient capability list"):
 *   1. Zod parseWithFallback for endpoints with schemas (drift defense)
 *   2. onUnauthorized callback on 401 (auto sign-out, avoids retry loops)
 *   3. X-Request-ID per request + structured logger (debug + tracing)
 *   4. Bearer auth + X-Workspace-Slug — NOT cookie auth (no CSRF, no credentials)
 */
import type { Agent, AgentTask, Attachment, ChatMessage, ChatPendingTask, ChatSession, CreateLabelRequest, InboxItem, InboxWorkspaceUnread, Label, ListLabelsResponse, MemberWithUser, RuntimeDevice, SendChatMessageResponse, NotificationPreferenceResponse, NotificationPreferences, TaskMessagePayload, UpdateMeRequest, User, Workspace, WorkspaceSubscriptionSummary } from "@auro/core/types";
import { AppConfigSchema, EMPTY_APP_CONFIG, EMPTY_REFRESH_SESSION_RESPONSE, RefreshSessionResponseSchema, WorkspaceSubscriptionSummarySchema } from "@auro/core/api/schemas";
import type {
  AppConfigResponse,
  RefreshSessionResponse,
} from "@auro/core/api/schemas";
import { AgentListSchema, AgentTaskListSchema, AttachmentSchema, ChatMessageListSchema, ChatPendingTaskSchema, ChatSessionListSchema, ChatSessionSchema, EMPTY_AGENT_LIST, EMPTY_AGENT_TASK_LIST, EMPTY_CHAT_MESSAGE_LIST, EMPTY_CHAT_PENDING_TASK, EMPTY_CHAT_SESSION_LIST, EMPTY_INBOX_LIST, EMPTY_INBOX_UNREAD_SUMMARY, EMPTY_LIST_LABELS_RESPONSE, EMPTY_MEMBER_LIST, EMPTY_NOTIFICATION_PREFERENCES, EMPTY_RUNTIME_LIST, EMPTY_USER, EMPTY_WORKSPACE_LIST, InboxItemSchema, InboxListSchema, InboxUnreadSummarySchema, NotificationPreferenceResponseSchema, ListLabelsResponseSchema, MemberListSchema, RuntimeListSchema, SendChatMessageResponseSchema, TaskMessageListSchema, EMPTY_TASK_MESSAGE_LIST, UserSchema, LoginResponseSchema, WorkspaceListSchema } from "./schemas";
import type { ZodType } from "zod";
import { getCurrentSlug } from "./workspace-store";
import { parseWithFallback } from "@/lib/parse-response";
import { createRequestId } from "@/lib/request-id";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error(
    "EXPO_PUBLIC_API_URL is not set. Add it to the apps/mobile env file for " +
      "the variant you are running (see apps/mobile/README.md).",
  );
}

export interface LoginResponse {
  token: string;
  user: User;
}

/** Mobile file payload for `uploadFile`. RN doesn't have a browser `File`
 *  object; the fetch `FormData` polyfill accepts `{ uri, name, type }`
 *  directly and streams from disk. expo-image-picker / expo-document-picker
 *  return assets that map straight onto this shape. */
export interface FileAsset {
  uri: string;
  name: string;
  type: string;
}

/** Web mirrors this from `packages/core/constants/upload.ts`. Mobile keeps
 *  its own copy per the `mirror, don't import` rule in apps/mobile/CLAUDE.md. */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Hard ceiling for every HTTP request. Mobile-specific because iOS may
 *  suspend a backgrounded network task without ever resolving/rejecting
 *  the JS-side fetch promise (facebook/react-native#35384). Without this
 *  timeout, a refetch fired after returning to foreground can leave the
 *  query stuck in `isRefetching` state forever (visible as the
 *  pull-to-refresh spinner never going away). 30s is generous for any
 *  reasonable Auro payload size on cellular. */
const FETCH_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiClientOptions {
  /** Called once when the server returns 401. The platform layer wires this
   *  to clear the token + navigate to /login so a stale token doesn't keep
   *  every subsequent request looping on 401. */
  onUnauthorized?: () => void;
}

class ApiClient {
  private token: string | null = null;
  private options: ApiClientOptions = {};

  setToken(token: string | null) {
    this.token = token;
  }

  /** The bearer token in use, or null when signed out. Session renewal reads
   *  it to confirm the session it started from is still the live one, and the
   *  WS client reads it so a reconnect uses the current credential. */
  getToken(): string | null {
    return this.token;
  }

  setOptions(options: ApiClientOptions) {
    this.options = { ...this.options, ...options };
  }

  private async fetch<T>(
    path: string,
    init: RequestInit & { signal?: AbortSignal } = {},
  ): Promise<T> {
    const rid = createRequestId();
    const start = Date.now();
    const method = init.method ?? "GET";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Client-Platform": "mobile",
      "X-Client-OS": "ios",
      "X-Client-Version": "0.1.0",
      "X-Request-ID": rid,
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    // Backend middleware (server/internal/middleware/workspace.go) resolves
    // slug → ws UUID and gates membership. Mirrors packages/core/api/client.ts.
    const slug = getCurrentSlug();
    if (slug && !headers["X-Workspace-Slug"]) {
      headers["X-Workspace-Slug"] = slug;
    }

    // Timeout + caller-signal forwarding.
    //
    // Hermes does NOT support AbortSignal.timeout() or AbortSignal.any() —
    // see facebook/react-native#42042 and livekit#4014. So we manually
    // compose a single controller that aborts on:
    //   (a) caller-side signal (TQ cancelling a stale/inactive query, etc),
    //   (b) 30s timeout (defends against iOS suspending the network task
    //       silently during background — fetch() then never resolves;
    //       facebook/react-native#35384). Without this, a refetch
    //       triggered by WS reconnect can leave the FlatList pull-to-refresh
    //       spinner stuck on the screen indefinitely.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`request timed out after ${FETCH_TIMEOUT_MS}ms`));
    }, FETCH_TIMEOUT_MS);
    const callerSignal = init.signal;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else callerSignal.addEventListener("abort", onCallerAbort);
    }

    console.log(`[api] → ${method} ${path}`, { rid });

    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      // Re-throw with a clearer message if this was our own timeout abort.
      if (
        err instanceof Error &&
        err.name === "AbortError" &&
        !callerSignal?.aborted
      ) {
        const duration = Date.now() - start;
        console.warn(`[api] ← TIMEOUT ${path}`, {
          rid,
          duration: `${duration}ms`,
        });
        throw new ApiError(
          `Request timed out after ${FETCH_TIMEOUT_MS}ms`,
          0,
          undefined,
        );
      }
      throw err;
    }
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    const duration = Date.now() - start;

    if (!res.ok) {
      // 401 sign-out hook: invoke once, let the platform layer (auth-store)
      // clear the token + navigate. Subsequent requests in flight will also
      // 401 and re-enter here, so the callback must be idempotent.
      if (res.status === 401 && !path.startsWith("/auth/")) {
        this.options.onUnauthorized?.();
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      const message =
        (body && typeof body === "object" && "error" in body ? String(body.error) : null) ??
        (body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `${res.status} ${res.statusText}`;

      const level = res.status === 404 ? "warn" : "error";
      console[level](`[api] ← ${res.status} ${path}`, {
        rid,
        duration: `${duration}ms`,
        error: message,
      });

      throw new ApiError(message, res.status, body);
    }

    console.log(`[api] ← ${res.status} ${path}`, {
      rid,
      duration: `${duration}ms`,
    });

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Read-side helper: GET + zod parse + fallback in one call. Collapses
   * the boilerplate that every list/detail endpoint repeats:
   *
   *   const raw = await this.fetch<unknown>(path, { signal: opts?.signal });
   *   return parseWithFallback(raw, Schema, FALLBACK, { endpoint: "name" });
   *
   * Always uses GET (no method arg) — write endpoints that need parsing
   * still go through `this.fetch` + `parseWithFallback` directly because
   * they carry a body and care about method semantics. Use
   * `fetchValidatedWith` for those (PATCH / PUT / POST).
   *
   * The `endpoint` label defaults to the request path — override only when
   * the path has dynamic segments and you want stable telemetry labels.
   */
  private async fetchValidated<T>(
    path: string,
    schema: ZodType,
    fallback: T,
    opts?: { signal?: AbortSignal; endpoint?: string },
  ): Promise<T> {
    const raw = await this.fetch<unknown>(path, { signal: opts?.signal });
    return parseWithFallback(raw, schema, fallback, {
      endpoint: opts?.endpoint ?? path,
    });
  }

  /** Same as fetchValidated but supports any HTTP method + body. Used by
   *  PATCH/PUT/POST endpoints whose response we still want to validate
   *  (e.g. updateMe returns User, updateNotificationPreferences returns
   *  NotificationPreferenceResponse). */
  private async fetchValidatedWith<T>(
    path: string,
    schema: ZodType,
    fallback: T,
    init: RequestInit,
    opts?: { signal?: AbortSignal; endpoint?: string; redact?: boolean },
  ): Promise<T> {
    // `opts.signal` wins if both are passed, but absent opts.signal does
    // NOT clear init.signal — important because forgetting `?? init.signal`
    // would silently strip a caller's abort signal when they used the
    // RequestInit shape but no opts.
    const raw = await this.fetch<unknown>(path, {
      ...init,
      signal: opts?.signal ?? init.signal ?? undefined,
    });
    return parseWithFallback(raw, schema, fallback, {
      endpoint: opts?.endpoint ?? `${init.method ?? "GET"} ${path}`,
      redact: opts?.redact,
    });
  }

  // --- Auth ---
  async sendCode(email: string): Promise<void> {
    await this.fetch<void>("/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  private async authenticate(path: string, body: object): Promise<LoginResponse> {
    const result = await this.fetchValidatedWith<LoginResponse | null>(path, LoginResponseSchema, null, {
      method: "POST", body: JSON.stringify(body),
    }, { redact: true });
    if (!result) throw new Error("Invalid sign-in response. Please try again.");
    return result;
  }

  async loginWithPassword(email: string, password: string): Promise<LoginResponse> {
    return this.authenticate("/auth/login", { email, password });
  }

  async verifyCode(email: string, code: string, password?: string): Promise<LoginResponse> {
    return this.authenticate("/auth/verify-code", { email, code, ...(password !== undefined ? { password } : {}) });
  }

  async refreshSession(): Promise<RefreshSessionResponse> {
    return this.fetchValidatedWith(
      "/api/auth/refresh",
      RefreshSessionResponseSchema,
      EMPTY_REFRESH_SESSION_RESPONSE,
      { method: "POST" },
      { endpoint: "refreshSession" },
    );
  }

  async getMe(opts?: { signal?: AbortSignal }): Promise<User> {
    return this.fetchValidated(
      "/api/me",
      UserSchema,
      EMPTY_USER,
      { ...opts, endpoint: "getMe" },
    );
  }

  async getConfig(opts?: { signal?: AbortSignal }): Promise<AppConfigResponse> {
    return this.fetchValidated<AppConfigResponse>(
      "/api/config",
      AppConfigSchema,
      EMPTY_APP_CONFIG,
      { ...opts, endpoint: "getConfig" },
    );
  }

  async getWorkspaceSubscriptionSummary(opts?: {
    signal?: AbortSignal;
  }): Promise<WorkspaceSubscriptionSummary | null> {
    return this.fetchValidated<WorkspaceSubscriptionSummary | null>(
      "/api/cloud-subscriptions/summary",
      WorkspaceSubscriptionSummarySchema,
      null,
      { ...opts, endpoint: "getWorkspaceSubscriptionSummary" },
    );
  }

  // PATCH /api/me — name, avatar_url, language. Server returns the updated
  // user; we parse so a partial drift doesn't bleed into the auth store.
  async updateMe(data: UpdateMeRequest): Promise<User> {
    return this.fetchValidatedWith(
      "/api/me",
      UserSchema,
      EMPTY_USER,
      { method: "PATCH", body: JSON.stringify(data) },
      { endpoint: "updateMe" },
    );
  }

  // --- Notification preferences ---
  async getNotificationPreferences(
    opts?: { signal?: AbortSignal },
  ): Promise<NotificationPreferenceResponse> {
    return this.fetchValidated(
      "/api/notification-preferences",
      NotificationPreferenceResponseSchema,
      EMPTY_NOTIFICATION_PREFERENCES,
      { ...opts, endpoint: "getNotificationPreferences" },
    );
  }

  async updateNotificationPreferences(
    preferences: NotificationPreferences,
    workspaceSlug?: string,
  ): Promise<NotificationPreferenceResponse> {
    return this.fetchValidatedWith(
      "/api/notification-preferences",
      NotificationPreferenceResponseSchema,
      EMPTY_NOTIFICATION_PREFERENCES,
      {
        method: "PATCH",
        headers: workspaceSlug
          ? { "X-Workspace-Slug": workspaceSlug }
          : undefined,
        body: JSON.stringify({ preferences }),
      },
      { endpoint: "updateNotificationPreferences" },
    );
  }

  // --- Workspaces ---
  async listWorkspaces(opts?: {
    signal?: AbortSignal;
  }): Promise<Workspace[]> {
    const raw = await this.fetch<unknown>("/api/workspaces", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, WorkspaceListSchema, EMPTY_WORKSPACE_LIST, {
      endpoint: "listWorkspaces",
    });
  }

  // --- Inbox ---
  async listInbox(opts?: { signal?: AbortSignal }): Promise<InboxItem[]> {
    const raw = await this.fetch<unknown>("/api/inbox", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, InboxListSchema, EMPTY_INBOX_LIST, {
      endpoint: "listInbox",
    });
  }

  /**
   * Cross-workspace unread inbox counts, one entry per workspace with unread
   * items. Backs the inbox tab badge — see lib/unread-counts.ts for why the
   * badge reads this instead of counting `listInbox()` locally.
   */
  async getInboxUnreadSummary(opts?: {
    signal?: AbortSignal;
  }): Promise<InboxWorkspaceUnread[]> {
    const raw = await this.fetch<unknown>("/api/inbox/unread-summary", {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      InboxUnreadSummarySchema,
      EMPTY_INBOX_UNREAD_SUMMARY,
      { endpoint: "getInboxUnreadSummary" },
    );
  }

  async markInboxRead(id: string): Promise<InboxItem> {
    return this.fetchValidatedWith<InboxItem | null>(`/api/inbox/${encodeURIComponent(id)}/read`, InboxItemSchema, null, { method: "POST" }, { endpoint: "readInbox" }).then(item => { if (!item) throw new Error("Invalid inbox item response"); return item; });
  }

  // Validate consumed write responses so malformed payloads trigger rollback.
  async archiveInbox(id: string): Promise<InboxItem> {
    return this.fetchValidatedWith<InboxItem | null>(`/api/inbox/${encodeURIComponent(id)}/archive`, InboxItemSchema, null, { method: "POST" }, { endpoint: "archiveInbox" }).then(item => { if (!item) throw new Error("Invalid inbox item response"); return item; });
  }

  async markAllInboxRead(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/mark-all-read", {
      method: "POST",
    });
  }

  async archiveAllInbox(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/archive-all", {
      method: "POST",
    });
  }

  async archiveAllReadInbox(): Promise<{ count: number }> {
    return this.fetch<{ count: number }>("/api/inbox/archive-all-read", {
      method: "POST",
    });
  }

  // --- Members & Agents (for actor name/avatar lookup) ---
  async listMembers(
    workspaceId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<MemberWithUser[]> {
    const raw = await this.fetch<unknown>(
      `/api/workspaces/${workspaceId}/members`,
      { signal: opts?.signal },
    );
    return parseWithFallback(raw, MemberListSchema, EMPTY_MEMBER_LIST, {
      endpoint: "listMembers",
    });
  }

  async listAgents(opts?: { signal?: AbortSignal }): Promise<Agent[]> {
    const raw = await this.fetch<unknown>("/api/agents", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, AgentListSchema, EMPTY_AGENT_LIST, {
      endpoint: "listAgents",
    });
  }

  // Workspace runtimes — feeds the presence dot's availability dimension
  // (runtime.status + last_seen_at). Backend route registered in
  // server/cmd/server/router.go:514 (GET /api/runtimes).
  async listRuntimes(opts?: { signal?: AbortSignal }): Promise<RuntimeDevice[]> {
    const raw = await this.fetch<unknown>("/api/runtimes", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, RuntimeListSchema, EMPTY_RUNTIME_LIST, {
      endpoint: "listRuntimes",
    });
  }

  // Workspace-wide active agent tasks + each agent's most recent terminal —
  // feeds the workload dimension of presence (currently unused in the mobile
  // dot; reserved for the P1 long-press peek sheet). Listed here now so the
  // realtime invalidation path can be wired in one PR. Backend route at
  // server/cmd/server/router.go:539 (GET /api/agent-task-snapshot).
  async listAgentTaskSnapshot(
    opts?: { signal?: AbortSignal },
  ): Promise<AgentTask[]> {
    const raw = await this.fetch<unknown>("/api/agent-task-snapshot", {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, AgentTaskListSchema, EMPTY_AGENT_TASK_LIST, {
      endpoint: "listAgentTaskSnapshot",
    });
  }

  // --- Labels ---
  async listLabels(opts?: {
    signal?: AbortSignal;
  }): Promise<ListLabelsResponse> {
    const raw = await this.fetch<unknown>("/api/labels", {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      ListLabelsResponseSchema,
      EMPTY_LIST_LABELS_RESPONSE,
      { endpoint: "GET /api/labels" },
    );
  }

  // Create a new label and return it. Response is consumed by the
  // create-and-attach flow in label picker, so raw `this.fetch<Label>` is
  // used — same convention as createProject (cache rollback on failure is
  // preferable to a parseWithFallback fallback that would mask server errors).
  async createLabel(body: CreateLabelRequest): Promise<Label> {
    return this.fetch<Label>("/api/labels", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // --- Chat ---
  // Mirrors the surface area of packages/core/api/client.ts chat methods.
  // v1 omits getChatSession + updateChatSession (rename) — see the v1 cut
  // list in /Users/qingnaiyuan/.claude/plans/plan-velvety-puddle.md.

  async listChatSessions(
    opts?: { signal?: AbortSignal },
  ): Promise<ChatSession[]> {
    const raw = await this.fetch<unknown>("/api/chat/sessions", {
      signal: opts?.signal,
    });
    return parseWithFallback(
      raw,
      ChatSessionListSchema,
      EMPTY_CHAT_SESSION_LIST,
      { endpoint: "GET /api/chat/sessions" },
    );
  }

  async createChatSession(
    data: { agent_id: string; title?: string },
  ): Promise<ChatSession> {
    // Strict parse — a malformed create response derails the optimistic
    // burst (we need the new session id to seed caches). Fallback would
    // be worse than the throw.
    const raw = await this.fetch<unknown>("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    });
    const parsed = ChatSessionSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[api] ← shape mismatch POST /api/chat/sessions", {
        issues: parsed.error.issues,
      });
      throw new ApiError("Create chat session response invalid", 0, raw);
    }
    return parsed.data;
  }

  async deleteChatSession(id: string): Promise<void> {
    await this.fetch<void>(`/api/chat/sessions/${id}`, { method: "DELETE" });
  }

  async listChatMessages(
    sessionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ChatMessage[]> {
    const raw = await this.fetch<unknown>(
      `/api/chat/sessions/${sessionId}/messages`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      ChatMessageListSchema,
      EMPTY_CHAT_MESSAGE_LIST,
      { endpoint: "GET /api/chat/sessions/:id/messages" },
    );
  }

  async sendChatMessage(
    sessionId: string,
    content: string,
    opts?: { attachmentIds?: string[] },
  ): Promise<SendChatMessageResponse> {
    // Strict parse — we need task_id + created_at to anchor the optimistic
    // StatusPill. Fallback would silently break the elapsed-time timer.
    //
    // `attachment_ids` mirrors the comment / issue create payloads —
    // server-side `chat.go` back-fills `chat_message_id` on the listed
    // attachments after the message row is inserted (see
    // server/internal/handler/chat.go:410-456).
    const body: { content: string; attachment_ids?: string[] } = { content };
    if (opts?.attachmentIds && opts.attachmentIds.length > 0) {
      body.attachment_ids = opts.attachmentIds;
    }
    const raw = await this.fetch<unknown>(
      `/api/chat/sessions/${sessionId}/messages`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    const parsed = SendChatMessageResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[api] ← shape mismatch POST /api/chat/sessions/:id/messages", {
        issues: parsed.error.issues,
      });
      throw new ApiError("Send message response invalid", 0, raw);
    }
    return parsed.data;
  }

  async getPendingChatTask(
    sessionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ChatPendingTask> {
    const raw = await this.fetch<unknown>(
      `/api/chat/sessions/${sessionId}/pending-task`,
      { signal: opts?.signal },
    );
    return parseWithFallback(
      raw,
      ChatPendingTaskSchema,
      EMPTY_CHAT_PENDING_TASK,
      { endpoint: "GET /api/chat/sessions/:id/pending-task" },
    );
  }

  async markChatSessionRead(sessionId: string): Promise<void> {
    await this.fetch<void>(
      `/api/chat/sessions/${sessionId}/read`,
      { method: "POST" },
    );
  }

  async cancelTaskById(taskId: string): Promise<void> {
    await this.fetch<void>(`/api/tasks/${taskId}/cancel`, { method: "POST" });
  }

  /** Live execution timeline for a task — used by the chat screen to
   *  render the "thinking → tool_use → tool_result → final text" trace
   *  beneath an in-flight assistant bubble. `task:message` WS events
   *  append to the same cache key in real time (see
   *  use-chat-session-realtime.ts). */
  async listTaskMessages(
    taskId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<TaskMessagePayload[]> {
    return this.fetchValidated(
      `/api/tasks/${taskId}/messages`,
      TaskMessageListSchema,
      EMPTY_TASK_MESSAGE_LIST,
      { ...opts, endpoint: "GET /api/tasks/:id/messages" },
    );
  }

  // --- File Upload ---

  /**
   * Multipart-stream a file to `/api/upload-file`. Mirrors the web
   * implementation in `packages/core/api/client.ts:uploadFile` but with the
   * RN-shaped `FileAsset` instead of a browser `File`. The fetch FormData
   * polyfill recognises `{ uri, name, type }` and reads the file off disk.
   *
   * `opts.chatSessionId` binds the upload to its chat session. The send
   * request supplies attachment IDs to bind them to the saved message.
   *
   * Does NOT use `this.fetch` because:
   *   - FormData must not have a `Content-Type` header preset (the browser /
   *     RN fetch needs to set the multipart boundary itself).
   *   - `this.fetch` hard-codes `application/json`.
   *
   * So we re-implement the auth + slug + logging shell inline.
   */
  async uploadFile(
    asset: FileAsset,
    opts?: { chatSessionId?: string },
  ): Promise<Attachment> {
    const rid = createRequestId();
    const start = Date.now();
    const path = "/api/upload-file";

    const headers: Record<string, string> = {
      // No Content-Type — let fetch set the multipart boundary.
      "X-Client-Platform": "mobile",
      "X-Client-OS": "ios",
      "X-Client-Version": "0.1.0",
      "X-Request-ID": rid,
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const slug = getCurrentSlug();
    if (slug) headers["X-Workspace-Slug"] = slug;

    const formData = new FormData();
    // RN's FormData accepts `{ uri, name, type }` as the file value.
    // `as never` quiets TS (the global FormData type expects `Blob | string`).
    formData.append(
      "file",
      { uri: asset.uri, name: asset.name, type: asset.type } as never,
    );

    if (opts?.chatSessionId) formData.append("chat_session_id", opts.chatSessionId);

    console.log(`[api] → POST ${path}`, { rid, filename: asset.name });

    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers,
      body: formData,
    });
    const duration = Date.now() - start;

    if (!res.ok) {
      if (res.status === 401) this.options.onUnauthorized?.();
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      const message =
        (body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `Upload failed: ${res.status}`;
      console.error(`[api] ← ${res.status} ${path}`, {
        rid,
        duration: `${duration}ms`,
        error: message,
      });
      throw new ApiError(message, res.status, body);
    }

    console.log(`[api] ← ${res.status} ${path}`, {
      rid,
      duration: `${duration}ms`,
    });

    // Strict validation: parseWithFallback's silent-fallback pattern doesn't
    // fit here — an attachment without a `url` would be inserted into the
    // user's text as `![](undefined)`. Throw on shape mismatch so the
    // caller's Alert path fires instead of letting a broken link land in
    // the editor.
    const json: unknown = await res.json();
    const parsed = AttachmentSchema.safeParse(json);
    if (!parsed.success) {
      console.error(`[api] ← shape mismatch ${path}`, {
        rid,
        error: parsed.error.message,
      });
      throw new ApiError("Upload response invalid", res.status, json);
    }
    return parsed.data;
  }
}

export { MAX_FILE_SIZE };

export const api = new ApiClient();
