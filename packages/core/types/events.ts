
import type { Agent } from "./agent";
import type { InboxItem } from "./inbox";
import type { Workspace, MemberWithUser, Invitation } from "./workspace";

// WebSocket event types (matching Go server protocol/events.go)
export type WSEventType =
  | "agent:status"
  | "agent:created"
  | "agent:archived"
  | "agent:restored"
  | "task:queued"
  | "task:dispatch"
  | "task:running"
  | "task:waiting_local_directory"
  | "task:progress"
  | "task:completed"
  | "task:failed"
  | "task:message"
  | "task:cancelled"
  | "inbox:new"
  | "inbox:read"
  | "inbox:unread"
  | "inbox:archived"
  | "inbox:unarchived"
  | "inbox:batch-read"
  | "inbox:batch-archived"
  | "workspace:updated"
  | "workspace:deleted"
  | "member:added"
  | "member:updated"
  | "member:removed"
  | "daemon:heartbeat"
  | "daemon:register"
  | "skill:created"
  | "skill:updated"
  | "skill:deleted"
  | "chat:message"
  | "chat:done"
  | "chat:quick_actions"
  | "chat:cancel_finalized"
  | "chat:session_created"
  | "chat:session_read"
  | "chat:session_deleted"
  | "chat:session_updated"
  | "label:created"
  | "label:updated"
  | "label:deleted"
  | "invitation:created"
  | "invitation:accepted"
  | "invitation:declined"
  | "invitation:revoked"
  | "github_installation:created"
  | "github_installation:deleted";

export interface WSMessage<T = unknown> {
  type: WSEventType;
  payload: T;
  actor_id?: string;
  actor_type?: string;
}

export interface AgentStatusPayload {
  agent: Agent;
}

export interface AgentCreatedPayload {
  agent: Agent;
}

export interface AgentArchivedPayload {
  agent: Agent;
}

export interface AgentRestoredPayload {
  agent: Agent;
}

export interface InboxNewPayload {
  item: InboxItem;
}

export interface InboxReadPayload {
  item_id: string;
  recipient_id: string;
}

/** Emitted when a recipient flips a notification back to unread. */
export interface InboxUnreadPayload {
  item_id: string;
  recipient_id: string;
}

export interface InboxArchivedPayload {
  item_id: string;
  recipient_id: string;
}

export interface InboxUnarchivedPayload {
  item_id: string;
  recipient_id: string;
}

export interface InboxBatchReadPayload {
  recipient_id: string;
  count: number;
}

export interface InboxBatchArchivedPayload {
  recipient_id: string;
  count: number;
}

export interface WorkspaceUpdatedPayload {
  workspace: Workspace;
}

export interface WorkspaceDeletedPayload {
  workspace_id: string;
}

export interface MemberUpdatedPayload {
  member: MemberWithUser;
}

export interface MemberAddedPayload {
  member: MemberWithUser;
  workspace_id: string;
  workspace_name?: string;
}

export interface MemberRemovedPayload {
  member_id: string;
  user_id: string;
  workspace_id: string;
}

export interface TaskMessagePayload {
  /** Opaque tool-call identity, scoped to one backend execution. */
  call_id?: string;
  task_id: string;
  chat_session_id?: string;
  seq: number;
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error";
  tool?: string;
  content?: string;
  input?: Record<string, unknown>;
  output?: string;
  /**
   * Whether `output` is the whole tool output that ran (`tool_result` only).
   *
   * Tri-state on purpose. `undefined` means no daemon ever measured this
   * record — messages stored before the flag existed, and messages from an
   * older installed daemon — and must be presented as unknown, never as
   * complete: the original length is gone and cannot be reconstructed.
   * `true` means the remainder was never uploaded and no amount of expanding
   * or scrolling recovers it, which is what separates it from a client-side
   * display clip.
   */
  output_truncated?: boolean;
  created_at?: string;
}

export interface TaskQueuedPayload {
  task_id: string;
  agent_id: string;
  chat_session_id?: string;
  status: string;
}

export interface TaskDispatchPayload {
  task_id: string;
  agent_id: string;
  runtime_id: string;
  chat_session_id?: string;
}

export interface TaskRunningPayload {
  task_id: string;
  agent_id: string;
  chat_session_id?: string;
  status: string;
}

// task:waiting_local_directory fires when the daemon dequeues a task but
// can't immediately acquire the on-disk path lock — another task on this
// daemon is already executing in the same local_directory. `wait_reason` names
// the directory and, when known, the short id of the task holding it; the
// StatusPill renders it so a parked task explains itself instead of just
// spinning. It is a display name, never an absolute path — the daemon strips
// that at the source (localDirectoryAssignment.DisplayName), because this text
// reaches every client on the session and lands in screenshots.
export interface TaskWaitingLocalDirectoryPayload {
  task_id: string;
  agent_id: string;
  chat_session_id?: string;
  status: string;
  wait_reason?: string;
}

export interface TaskCompletedPayload {
  task_id: string;
  agent_id: string;
  chat_session_id?: string;
  status: string;
}

export interface TaskFailedPayload {
  task_id: string;
  agent_id: string;
  chat_session_id?: string;
  status: string;
  failure_reason?: string;
  retry_pending?: boolean;
}

export interface TaskCancelledPayload {
  task_id: string;
  agent_id: string;
  chat_session_id?: string;
  status: string;
}

export interface ChatMessageEventPayload {
  chat_session_id: string;
  message_id: string;
  role: "user" | "assistant";
  content: string;
  task_id?: string;
  created_at: string;
}

export interface ChatDonePayload {
  chat_session_id: string;
  task_id: string;
  /**
   * Server populates these from the freshly-persisted assistant ChatMessage
   * row so the WS handler can write it into the messages cache inline. Older
   * servers (pre-#2123) only sent chat_session_id + task_id; treat every field
   * below as optional and fall back to a refetch when absent.
   */
  message_id?: string;
  content?: string;
  elapsed_ms?: number;
  created_at?: string;
  /**
   * "message" (default) or "no_response" — a completed direct-chat turn with
   * no text reply (MUL-4351). Optional/additive: older servers omit it, so the
   * consumer defaults to "message". Because direct-chat completion now always
   * persists exactly one assistant row, message_id/content/created_at are
   * populated alongside this even for a no_response turn.
   */
  message_kind?: import("./chat").ChatMessageKind;
  /** Server-validated follow-ups attached to the persisted assistant reply. */
  quick_actions?: import("./chat").ChatQuickAction[];
  /**
   * The daemon will follow up with a chat:quick_actions supplement for this
   * turn — render a placeholder. Never true alongside populated
   * quick_actions; absent on older servers/daemons.
   */
  quick_actions_pending?: boolean;
}

/**
 * chat:quick_actions — supplements a finished turn with the follow-up
 * suggestions from the daemon's background pass. An empty list is terminal:
 * "no suggestions this turn", resolve any placeholder.
 */
export interface ChatQuickActionsPayload {
  chat_session_id: string;
  task_id: string;
  message_id: string;
  quick_actions?: import("./chat").ChatQuickAction[];
  /**
   * The regeneration behind an explicit refresh failed: the actions carried
   * here are the turn's UNCHANGED prior pills, sent only to resolve the pending
   * spinner. Clients surface a "couldn't refresh" notice rather than treating
   * them as freshly generated. Absent/false on the normal success path and on
   * older servers.
   */
  failed?: boolean;
}

/**
 * Deferred outcome of a cancelled chat task (#5219). The cancel HTTP response
 * cannot carry it — the empty/non-empty judgment settles only after the
 * daemon's transcript flush — so the server broadcasts it here instead:
 * outcome "stopped" describes a freshly-persisted "Stopped." assistant row
 * (ChatDonePayload-shaped fields), outcome "restored" is a content-free
 * invalidation hint — the deleted prompt itself is durable server-side and
 * the initiator's client fetches it from the creator-authorized
 * draft-restores endpoint. All fields beyond the discriminator are optional —
 * treat defensively and fall back to a refetch.
 */
export interface ChatCancelFinalizedPayload {
  outcome: "stopped" | "restored";
  chat_session_id: string;
  task_id: string;
  /**
   * The user who triggered the cancelled task. Only this user's client needs
   * to refetch draft restores; treat a missing value as "not me" (fail
   * closed — the durable restore is still picked up on the next session
   * open).
   */
  initiator_user_id?: string;
  message_id?: string;
  /** "Stopped." assistant row fields — set only for outcome "stopped". */
  content?: string;
  message_kind?: import("./chat").ChatMessageKind;
  created_at?: string;
  elapsed_ms?: number;
}

export interface ChatSessionReadPayload {
  chat_session_id: string;
}

export interface ChatSessionDeletedPayload {
  chat_session_id: string;
}

export interface InvitationCreatedPayload {
  invitation: Invitation;
  workspace_name?: string;
}

export interface InvitationAcceptedPayload {
  invitation_id: string;
  member: MemberWithUser;
}

export interface InvitationDeclinedPayload {
  invitation_id: string;
  invitee_email: string;
}

export interface InvitationRevokedPayload {
  invitation_id: string;
  invitee_email: string;
}

export interface ChatSessionCreatedPayload {
  workspace_id: string;
  chat_session_id: string;
  agent_id: string;
  creator_id: string;
  title: string;
  channel_source: {
    channel_type: string;
    installation_id: string;
    route_revision: number;
  };
  is_current_channel_route: boolean;
}

/**
 * Maps every WSEventType to its payload interface. Events whose payload
 * shape isn't formally typed (server emits an object the client doesn't
 * meaningfully consume yet) fall back to `unknown` — callers must narrow
 * before access.
 *
 * Use via `WSEventPayload<E>` rather than indexing the map directly:
 *   const handler = (payload: WSEventPayload<"issue:created">) => { ... };
 *
 * Adding a new event: extend WSEventType first (above), then append a key
 * here. TS will compile-error every WSClient.on("new:event", …) site that
 * forgets the payload shape — that's the whole point.
 */
export interface WSEventPayloadMap {
  "agent:status": AgentStatusPayload;
  "agent:created": AgentCreatedPayload;
  "agent:archived": AgentArchivedPayload;
  "agent:restored": AgentRestoredPayload;
  "task:queued": TaskQueuedPayload;
  "task:dispatch": TaskDispatchPayload;
  "task:running": TaskRunningPayload;
  "task:waiting_local_directory": TaskWaitingLocalDirectoryPayload;
  "task:completed": TaskCompletedPayload;
  "task:failed": TaskFailedPayload;
  "task:message": TaskMessagePayload;
  "task:cancelled": TaskCancelledPayload;
  "task:progress": unknown;
  "inbox:new": InboxNewPayload;
  "inbox:read": InboxReadPayload;
  "inbox:unread": InboxUnreadPayload;
  "inbox:archived": InboxArchivedPayload;
  "inbox:unarchived": InboxUnarchivedPayload;
  "inbox:batch-read": InboxBatchReadPayload;
  "inbox:batch-archived": InboxBatchArchivedPayload;
  "workspace:updated": WorkspaceUpdatedPayload;
  "workspace:deleted": WorkspaceDeletedPayload;
  "member:added": MemberAddedPayload;
  "member:updated": MemberUpdatedPayload;
  "member:removed": MemberRemovedPayload;
  "chat:message": ChatMessageEventPayload;
  "chat:done": ChatDonePayload;
  "chat:quick_actions": ChatQuickActionsPayload;
  "chat:cancel_finalized": ChatCancelFinalizedPayload;
  "chat:session_created": ChatSessionCreatedPayload;
  "chat:session_read": ChatSessionReadPayload;
  "chat:session_deleted": ChatSessionDeletedPayload;
  "chat:session_updated": unknown;
  "invitation:created": InvitationCreatedPayload;
  "invitation:accepted": InvitationAcceptedPayload;
  "invitation:declined": InvitationDeclinedPayload;
  "invitation:revoked": InvitationRevokedPayload;
  // No formal payload interfaces yet — server emits domain objects clients
  // currently consume as opaque triggers (refetch on receipt).
  "daemon:heartbeat": unknown;
  "daemon:register": unknown;
  "skill:created": unknown;
  "skill:updated": unknown;
  "skill:deleted": unknown;
  "label:created": unknown;
  "label:updated": unknown;
  "label:deleted": unknown;
  "github_installation:created": unknown;
  "github_installation:deleted": unknown;
}

/**
 * Payload type for a given event. Lookup against WSEventPayloadMap with
 * `unknown` as the safety net — if a future WSEventType is added without
 * a map entry, callers see `unknown` (forced narrow) rather than `any`
 * (silent unsafe access).
 */
export type WSEventPayload<E extends WSEventType> =
  E extends keyof WSEventPayloadMap ? WSEventPayloadMap[E] : unknown;
