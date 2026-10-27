import { fireEvent, render, screen } from "@testing-library/react";
import { buildIssueStatusCatalog } from "@auro/core/issue-statuses/queries";

vi.mock("@auro/core/issue-statuses/hooks", () => ({
  useIssueStatuses: () => buildIssueStatusCatalog([]),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PinnedItem } from "@auro/core/types";
import { renderWithI18n } from "../test/i18n";
import { AppSidebar } from "./app-sidebar";

const { agents, detail, deletePin, invitationApi, navigation, pins, sidebarState, summary, workspaces, viewDetails } = vi.hoisted(() => ({
  agents: {
    current: [] as {
      id: string;
      name: string;
      avatar_url: string | null;
      archived_at: string | null;
    }[],
  },
  sidebarState: { setOpenMobile: vi.fn() },
  detail: { current: { isPending: false, isError: false, data: null as unknown, error: null as unknown } },
  deletePin: vi.fn(),
  // Captures the sidebar's invitation accept/decline mutations so the
  // self-heal wiring (error → invalidate the pending list) is observable.
  invitationApi: {
    accept: vi.fn(),
    decline: vi.fn(),
    invalidateQueries: vi.fn(),
    mutations: [] as Array<Record<string, unknown>>,
  },
  navigation: { current: { pathname: "/acme/issues" } },
  summary: { current: [] as { workspace_id: string; count: number }[] },
  workspaces: {
    current: [] as { id: string; name: string; slug: string; avatar_url: string | null }[],
  },
  viewDetails: { current: {} as Record<string, { id: string; name: string; scope_type: string }> },
  pins: {
    current: [
      {
        id: "pin-1",
        workspace_id: "ws-1",
        user_id: "user-1",
        item_type: "issue" as const,
        item_id: "issue-1",
        position: 0,
        created_at: "2026-05-06T00:00:00Z",
      },
    ] as PinnedItem[],
  },
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: vi.fn(),
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(),
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn() }),
  verticalListSortingStrategy: vi.fn(),
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Transform: { toString: () => undefined } } }));
vi.mock("@auro/ui/components/ui/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarMenuButton: ({
    children,
    isActive,
    render,
    ...props
  }: {
    children: React.ReactNode;
    isActive?: boolean;
    render?: React.ReactElement<{ href?: string }>;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} type="button" data-active={isActive ? "true" : undefined} data-href={render?.props.href}>
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarRail: () => null,
  useSidebar: () => ({ setOpenMobile: sidebarState.setOpenMobile }),
}));
vi.mock("@auro/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
}));
vi.mock("@auro/ui/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CollapsibleTrigger: () => <button type="button" />,
}));
vi.mock("@auro/ui/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));
vi.mock("./help-launcher", () => ({ HelpLauncher: () => null }));
vi.mock("../auth", () => ({ useLogout: () => vi.fn() }));
vi.mock("../issues/components/status-icon", () => ({ StatusIcon: () => <span /> }));
vi.mock("../navigation", () => ({
  AppLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useNavigation: () => ({ pathname: navigation.current.pathname, push: vi.fn() }),
}));
vi.mock("../projects/components/project-icon", () => ({ ProjectIcon: () => <span /> }));
vi.mock("../workspace/workspace-avatar", () => ({ WorkspaceAvatar: () => <span /> }));
vi.mock("@auro/ui/components/common/actor-avatar", () => ({ ActorAvatar: () => <span /> }));

vi.mock("@auro/core/auth", () => ({
  useAuthStore: (
    selector: (state: {
      user: { id: string; name: string; avatar_url: string | null };
    }) => unknown,
  ) => selector({ user: { id: "user-1", name: "Ada Lovelace", avatar_url: null } }),
}));
vi.mock("@auro/core/paths", async (importOriginal) => ({
  // Spread the real module so pure helpers (resolveRouteIconName, used by the
  // nav to derive each item's icon from its href) stay intact; only the
  // workspace/context hooks below are stubbed to control routes in tests.
  ...(await importOriginal<typeof import("@auro/core/paths")>()),
  paths: { workspace: (slug: string) => ({ root: () => `/${slug}/chat` }) },
  useCurrentWorkspace: () => ({ id: "ws-1", name: "Acme", slug: "acme" }),
  useWorkspacePaths: () => ({
    inbox: () => "/acme/inbox",
    root: () => "/acme/chat",
    issues: () => "/acme/issues",
    projects: () => "/acme/projects",
    autopilots: () => "/acme/autopilots",
    agents: () => "/acme/agents",
    usage: () => "/acme/usage",
    runtimes: () => "/acme/runtimes",
    skills: () => "/acme/skills",
    siege: () => "/acme/siege",
    tanks: () => "/acme/tanks",
    me: () => "/acme/me",
    settings: () => "/acme/settings",
    issueDetail: (id: string) => `/acme/issues/${id}`,
    projectDetail: (id: string) => `/acme/projects/${id}`,
    agentDetail: (id: string) => `/acme/agents/${id}`,
    chatWithAgent: (id: string) => `/acme/chat?agent=${id}`,
  }),
}));
vi.mock("@auro/core/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@auro/core/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getBaseUrl: () => "http://127.0.0.1:8080",
      acceptInvitation: invitationApi.accept,
      declineInvitation: invitationApi.decline,
    },
  };
});
vi.mock("@auro/core/inbox/queries", () => ({
  inboxUnreadSummaryOptions: () => ({ queryKey: ["inbox", "unread-summary"] }),
  // The nav badge and the switcher dot read the SAME cross-workspace summary,
  // so the fixture that drives one drives the other.
  useInboxUnreadCount: (currentWsId: string | null) =>
    summary.current.find((s) => s.workspace_id === currentWsId)?.count ?? 0,
  hasOtherWorkspaceUnread: (
    entries: { workspace_id: string; count: number }[],
    currentWsId: string | null,
  ) => entries.some((s) => s.workspace_id !== currentWsId && s.count > 0),
  unreadWorkspaceIds: (entries: { workspace_id: string; count: number }[]) =>
    new Set(entries.filter((s) => s.count > 0).map((s) => s.workspace_id)),
}));
vi.mock("@auro/core/issues/queries", () => ({ issueDetailOptions: () => ({ queryKey: ["issue"] }) }));
vi.mock("@auro/core/issues/stores/create-mode-store", () => ({
  useCreateModeStore: { getState: () => ({ lastMode: "agent" }) },
  openCreateIssueWithPreference: vi.fn(),
}));
vi.mock("@auro/core/issues/stores/draft-store", () => ({ useIssueDraftStore: () => false }));
vi.mock("@auro/core/modals", () => ({ useModalStore: { getState: () => ({ modal: null, open: vi.fn() }) } }));
vi.mock("@auro/core/pins/mutations", () => ({ useDeletePin: () => ({ mutate: deletePin }), useReorderPins: () => ({ mutate: vi.fn() }) }));
vi.mock("@auro/core/pins/queries", () => ({ pinListOptions: () => ({ queryKey: ["pins"] }) }));
vi.mock("@auro/core/projects/queries", () => ({ projectDetailOptions: () => ({ queryKey: ["project"] }) }));
vi.mock("@auro/core/workspace/queries", () => ({
  agentListOptions: (wsId: string) => ({ queryKey: ["agents", wsId] }),
  myInvitationListOptions: () => ({ queryKey: ["invitations"] }),
  workspaceKeys: { myInvitations: () => ["invitations"] },
  workspaceListOptions: () => ({ queryKey: ["workspaces"] }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useMutation: (options: Record<string, unknown> = {}) => {
    invitationApi.mutations.push(options);
    return { isPending: false, mutate: vi.fn() };
  },
  useQueries: ({ queries }: { queries: { queryKey: readonly unknown[] }[] }) =>
    queries.map(({ queryKey }) => ({ data: viewDetails.current[String(queryKey[3])] })),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[0] === "issue-views") return { data: viewDetails.current[String(queryKey[3])] };
    if (queryKey[0] === "pins") return { data: pins.current };
    if (queryKey[0] === "issue") return detail.current;
    if (queryKey[0] === "inbox" && queryKey[1] === "unread-summary") return { data: summary.current };
    if (queryKey[0] === "workspaces") return { data: workspaces.current };
    if (queryKey[0] === "agents") return { data: agents.current };
    return { data: [] };
  },
  useQueryClient: () => ({ fetchQuery: vi.fn(), invalidateQueries: invitationApi.invalidateQueries }),
}));

describe("mobile sheet dismissal", () => {
  beforeEach(() => {
    sidebarState.setOpenMobile.mockClear();
    navigation.current = { pathname: "/acme/issues" };
  });

  it("dismisses the sheet once the route changes", () => {
    const { rerender } = render(<AppSidebar />);
    sidebarState.setOpenMobile.mockClear();

    navigation.current = { pathname: "/acme/inbox" };
    rerender(<AppSidebar />);

    expect(sidebarState.setOpenMobile).toHaveBeenCalledWith(false);
  });

  // Closing on `pathname` rather than per-link keeps every route out of the
  // sidebar covered at once — nav groups, pins, and the switcher's own push.
  it("does not re-dismiss while the route holds still", () => {
    const { rerender } = render(<AppSidebar />);
    sidebarState.setOpenMobile.mockClear();

    rerender(<AppSidebar />);

    expect(sidebarState.setOpenMobile).not.toHaveBeenCalled();
  });
});

describe("workspace-switcher unread dot", () => {
  beforeEach(() => {
    summary.current = [];
    workspaces.current = [];
  });

  // The aggregate switcher dot is the only `.ring-sidebar` span in the tree
  // (DraftDot is null when there's no draft, and there are no invitations).
  const dot = (container: HTMLElement) => container.querySelector("span.bg-brand.ring-sidebar");

  it("shows a dot when another workspace has unread inbox items", () => {
    summary.current = [{ workspace_id: "ws-2", count: 3 }];
    const { container } = render(<AppSidebar />);
    expect(dot(container)).not.toBeNull();
  });

  it("does not show a dot when only the active workspace has unread", () => {
    // Active workspace is ws-1 (see useCurrentWorkspace mock).
    summary.current = [{ workspace_id: "ws-1", count: 3 }];
    const { container } = render(<AppSidebar />);
    expect(dot(container)).toBeNull();
  });

  it("does not show a dot when no workspace has unread", () => {
    summary.current = [];
    const { container } = render(<AppSidebar />);
    expect(dot(container)).toBeNull();
  });
});

describe("workspace-switcher dropdown per-workspace dot", () => {
  beforeEach(() => {
    summary.current = [];
    // Active workspace is ws-1 (see useCurrentWorkspace mock); "Other" is ws-2.
    workspaces.current = [
      { id: "ws-1", name: "Active WS", slug: "active", avatar_url: null },
      { id: "ws-2", name: "Other WS", slug: "other", avatar_url: null },
    ];
  });

  // Row dots are brand dots WITHOUT the aggregate avatar dot's `ring-sidebar`.
  const rowDots = (container: HTMLElement) =>
    container.querySelectorAll("span.bg-brand:not(.ring-sidebar)");

  it("dots the specific other workspace that has unread", () => {
    summary.current = [{ workspace_id: "ws-2", count: 3 }];
    const { container } = render(<AppSidebar />);
    // Exactly one row dot, sitting right after the "Other WS" name; the active
    // row shows the check, not a dot.
    expect(rowDots(container)).toHaveLength(1);
    expect(screen.getByText("Other WS").nextElementSibling?.className).toContain("bg-brand");
    expect(screen.getByText("Active WS").nextElementSibling?.className ?? "").not.toContain("bg-brand");
  });

  it("does not dot a workspace whose unread count is zero", () => {
    summary.current = [{ workspace_id: "ws-2", count: 0 }];
    const { container } = render(<AppSidebar />);
    expect(rowDots(container)).toHaveLength(0);
  });

  it("never dots the active workspace even when it has unread", () => {
    summary.current = [{ workspace_id: "ws-1", count: 5 }];
    const { container } = render(<AppSidebar />);
    expect(rowDots(container)).toHaveLength(0);
  });
});

describe("navigation item presentation", () => {
  it("gives tank defense its own workspace entry and selected state", () => {
    navigation.current.pathname = "/acme/tanks";
    const { container } = renderWithI18n(<AppSidebar />);
    const tanks = container.querySelector('button[data-href="/acme/tanks"]');
    expect(tanks?.textContent).toContain("Tank Defense");
    expect(tanks?.getAttribute("data-active")).toBe("true");
    expect(container.querySelector('button[data-href="/acme/siege"]')?.getAttribute("data-active")).not.toBe("true");
    navigation.current.pathname = "/acme/issues";
  });

  it("links the footer profile row to the personal profile page", () => {
    const { container } = renderWithI18n(<AppSidebar />);

    const profile = container.querySelector(
      'button[data-href="/acme/settings?tab=profile"]',
    );
    expect(profile).toHaveTextContent("Ada Lovelace");
  });

  it("keeps Analytics and Settings styled like the other nav items", () => {
    const { container } = render(<AppSidebar />);
    const referenceClassName = container.querySelector(
      'button[data-href="/acme/inbox"]',
    )?.className;

    expect(referenceClassName).toBeTruthy();

    for (const href of ["/acme/usage", "/acme/settings"]) {
      expect(container.querySelector(`button[data-href="${href}"]`)?.className).toBe(
        referenceClassName,
      );
    }
  });
});

describe("work group agents", () => {
  const agent = (id: string, name: string, archived = false) => ({
    id,
    name,
    avatar_url: null,
    archived_at: archived ? "2026-01-01T00:00:00Z" : null,
  });

  beforeEach(() => {
    agents.current = [];
    navigation.current = { pathname: "/acme/issues" };
  });

  it("omits the retired chat entry", () => {
    const { container } = render(<AppSidebar />);
    expect(container.querySelector('button[data-href="/acme/chat"]')).toBeNull();
  });

  it("omits the retired squads entry", () => {
    const { container } = render(<AppSidebar />);
    expect(container.querySelector('button[data-href="/acme/squads"]')).toBeNull();
  });

  it("links created agents into a chat bound to that agent", () => {
    agents.current = [agent("agent-1", "Scout"), agent("agent-2", "Builder")];
    const { container } = render(<AppSidebar />);

    expect(container.querySelector('button[data-href="/acme/chat?agent=agent-1"]')).toHaveTextContent("Scout");
    expect(container.querySelector('button[data-href="/acme/chat?agent=agent-2"]')).toHaveTextContent("Builder");
    expect(container.querySelector('button[data-href="/acme/agents"]')).not.toBeNull();
  });

  it("skips archived agents", () => {
    agents.current = [agent("agent-1", "Scout"), agent("agent-2", "Retired", true)];
    const { container } = render(<AppSidebar />);

    expect(container.querySelector('button[data-href="/acme/chat?agent=agent-1"]')).not.toBeNull();
    expect(container.querySelector('button[data-href="/acme/chat?agent=agent-2"]')).toBeNull();
  });

  it("shows five agents and expands the rest", () => {
    agents.current = Array.from({ length: 7 }, (_, index) => agent(`agent-${index + 1}`, `Agent ${index + 1}`));
    const { container } = renderWithI18n(<AppSidebar />);

    expect(container.querySelectorAll('button[data-href^="/acme/chat?agent="]')).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Show 2 more…" }));

    expect(container.querySelectorAll('button[data-href^="/acme/chat?agent="]')).toHaveLength(7);
  });
});

describe("Pending invitation self-heal", () => {
  beforeEach(() => {
    invitationApi.accept.mockReset();
    invitationApi.decline.mockReset();
    invitationApi.invalidateQueries.mockClear();
    invitationApi.mutations.length = 0;
    invitationApi.accept.mockRejectedValue(new Error("invitation is not pending"));
    invitationApi.decline.mockRejectedValue(new Error("invitation is not pending"));
    navigation.current.pathname = "/acme/issues";
    workspaces.current = [];
  });

  // "invitation is not pending" means the row on screen was concluded from
  // another surface. Both mutations must invalidate the pending list on
  // failure so the stale row drops instead of surviving until restart.
  it("invalidates the pending-invitations list when accept or decline fails", async () => {
    render(<AppSidebar />);
    expect(invitationApi.mutations).toHaveLength(2);

    for (const options of invitationApi.mutations as Array<{
      mutationFn: (id: string) => Promise<unknown>;
      onError?: (...args: unknown[]) => unknown;
      onSettled?: (...args: unknown[]) => unknown;
    }>) {
      const settle = options.onError ?? options.onSettled;
      expect(settle).toBeTypeOf("function");
      invitationApi.invalidateQueries.mockClear();
      await expect(options.mutationFn("inv-1")).rejects.toThrow("invitation is not pending");
      await settle!(new Error("invitation is not pending"), "inv-1", undefined, undefined);
      expect(invitationApi.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invitations"] });
    }
    expect(invitationApi.accept).toHaveBeenCalledTimes(1);
    expect(invitationApi.decline).toHaveBeenCalledTimes(1);
  });
});
