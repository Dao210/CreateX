import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxItem } from "@auro/core/types";
import { renderWithI18n } from "../../test/i18n";
import { InboxPage } from "./inbox-page";

const state = vi.hoisted(() => ({ items: [] as InboxItem[], archived: [] as InboxItem[], params: new URLSearchParams(), replace: vi.fn(), markRead: vi.fn(), archive: vi.fn(), restore: vi.fn(), available: true, recover: vi.fn() }));
vi.mock("@auro/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@auro/core/paths", () => ({ useWorkspacePaths: () => ({ inbox: () => "/acme/inbox", tanks: () => "/acme/tanks", life: () => "/acme/life" }) }));
vi.mock("../../navigation", () => ({ useNavigation: () => ({ searchParams: state.params, replace: state.replace }), AppLink: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@auro/core/inbox/queries", () => ({ inboxListOptions: () => ({ queryKey: ["inbox"] }), archivedInboxPagesOptions: () => ({ queryKey: ["archive"] }), archivedInboxLookupOptions: () => ({ queryKey: ["lookup"] }) }));
vi.mock("@auro/core/admin", () => ({ useWorldGames: () => ({ data: { games: [{ gameId: "tanks", available: state.available }, { gameId: "life", available: state.available }] } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "lookup" ? { items: [] } : state.items }), useInfiniteQuery: () => ({ data: { pages: [{ items: state.archived }] }, hasNextPage: false }) }));
vi.mock("@auro/core/inbox/mutations", () => ({ useMarkInboxRead: () => ({ mutate: state.markRead }), useMarkInboxUnread: () => ({ mutate: vi.fn() }), useArchiveInbox: () => ({ mutate: state.archive }), useUnarchiveInbox: () => ({ mutate: state.restore }), useMarkAllInboxRead: () => ({ mutate: vi.fn() }) }));
vi.mock("../../modals/use-issue-limit-upgrade-prompt", () => ({ useIssueLimitUpgradePrompt: () => state.recover }));

function item(id: string, type: InboxItem["type"], issue_id: string | null = null): InboxItem {
  return { id, type, issue_id, title: id, body: `${id} body`, workspace_id: "ws-1", recipient_type: "member", recipient_id: "u", actor_type: "system", actor_id: null, severity: "info", issue_status: null, read: false, archived: false, details: null, created_at: "2026-10-25T00:00:00Z" };
}
beforeEach(() => { vi.clearAllMocks(); state.items = []; state.archived = []; state.available = true; state.params = new URLSearchParams(); });
describe("system notification inbox", () => {
  it("excludes task notifications and quick-create failures without mounting retired details", () => {
    state.items = [item("system notice", "autopilot_paused"), item("old task", "issue_assigned", "i-1"), item("old quick-create", "quick_create_failed")];
    renderWithI18n(<InboxPage />);
    expect(screen.getByText("system notice")).toBeInTheDocument();
    expect(screen.queryByText("old task")).not.toBeInTheDocument();
    expect(screen.queryByText("old quick-create")).not.toBeInTheDocument();
  });
  it("reads a selected system notification and marks it read", () => {
    state.items = [item("paused", "autopilot_paused")]; state.params = new URLSearchParams("issue=paused");
    renderWithI18n(<InboxPage />);
    expect(screen.getByText("paused body")).toBeInTheDocument();
    expect(state.markRead).toHaveBeenCalledWith("paused");
  });
  it("never redirects an old selection to the removed Issue route", () => {
    state.params = new URLSearchParams("issue=old-task"); renderWithI18n(<InboxPage />);
    expect(state.replace).not.toHaveBeenCalled(); expect(state.markRead).not.toHaveBeenCalled();
  });
  it("keeps archived system notices available and excludes archived tasks", () => {
    state.params = new URLSearchParams("view=archived"); state.archived = [item("archived system", "autopilot_paused"), item("archived task", "status_changed", "i-1")];
    renderWithI18n(<InboxPage />);
    expect(screen.getByText("archived system")).toBeInTheDocument(); expect(screen.queryByText("archived task")).not.toBeInTheDocument();
  });
  it("preserves recovery for an autopilot quota notification", () => {
    state.items = [item("quota", "autopilot_quota_exceeded")]; state.params = new URLSearchParams("issue=quota"); renderWithI18n(<InboxPage />);
    fireEvent.click(screen.getByText("View upgrade options")); expect(state.recover).toHaveBeenCalled();
  });
});

function worldMessage(): InboxItem {
  return { ...item("digest", "world_digest"), content: { entries: [{ id: "00000000-0000-4000-8000-000000000001", kind: "tank_created", subjectId: "00000000-0000-4000-8000-000000000002", name: "Forest scout", revision: 1, origin: "mcp", occurredAt: "2026-11-01T02:30:00Z" }], totals: { created: 1, updated: 0, milestones: 0 }, totalEntries: 1, windowStart: "2026-11-01T02:00:00Z", windowEnd: "2026-11-01T03:00:00Z" } };
}
it("preserves the world category in the URL and excludes personal notices from that view", () => {
  state.items = [worldMessage(), item("paused", "autopilot_paused")];
  state.params = new URLSearchParams("category=world");
  renderWithI18n(<InboxPage />);
  expect(screen.queryByText("paused")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "My creations" }));
  expect(state.replace).toHaveBeenCalledWith("/acme/inbox?category=creations");
});
it("renders a factual digest and links the character within its source world", () => {
  state.items = [worldMessage()]; state.params = new URLSearchParams("issue=digest");
  renderWithI18n(<InboxPage />);
  expect(screen.getByText("Forest scout · New creation")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View character" })).toHaveAttribute("href", "/acme/tanks?character=00000000-0000-4000-8000-000000000002");
  expect(state.markRead).toHaveBeenCalledWith("digest");
});
it("keeps historical content and removes game links when the game is closed", () => {
  state.available = false; state.items = [worldMessage()]; state.params = new URLSearchParams("issue=digest");
  renderWithI18n(<InboxPage />);
  expect(screen.getByText("Forest scout · New creation")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "View character" })).not.toBeInTheDocument();
  expect(screen.getByText("This game is currently unavailable in this world.")).toBeInTheDocument();
});

it("links an authoritative resident milestone to that resident in the bound world", () => {
  const message = worldMessage();
  message.content!.entries[0] = { ...message.content!.entries[0]!, kind: "resident_goal_reached", name: "Ada", goalKind: "coins", target: 20 };
  message.content!.totals = { created: 0, updated: 0, milestones: 0, residents: 1 };
  state.items = [message]; state.params = new URLSearchParams("issue=digest");
  renderWithI18n(<InboxPage />);
  expect(screen.getByText("Ada earned 20 coins")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View resident" })).toHaveAttribute("href", "/acme/life?resident=00000000-0000-4000-8000-000000000002");
});
