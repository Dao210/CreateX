import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@auro/core/i18n/react";
import { RESOURCES } from "@auro/views/locales";

/**
 * Regression guard for MUL-6231 / #7021: deleting the last workspace blanked
 * the desktop client.
 *
 * The shell used to decide whether to mount workspace-scoped chrome from the
 * `getCurrentSlug()` singleton alone. That singleton is mutable process state
 * with no owner keeping it in lockstep with the workspace list, so after the
 * active workspace was deleted it kept returning the dead slug — and the shell
 * kept `SearchCommand` mounted, whose `useWorkspaceId()` THROWS once the
 * workspace leaves the list. Nothing above the shell was an error boundary, so
 * that throw unmounted the entire renderer: a blank, unresponsive window.
 *
 * The invariant these tests lock is "a slug the workspace list no longer
 * contains mounts no workspace-scoped chrome", which is the same signal web's
 * DashboardGuard already gates on.
 */

const state = vi.hoisted(() => ({
  currentSlug: "acme" as string | null,
  wsList: [] as { id: string; slug: string }[],
}));

vi.mock("@/hooks/use-tab-history", () => ({
  useTabHistory: () => ({
    canGoBack: false,
    canGoForward: false,
    historyEntries: [],
    historyIndex: 0,
    browsingHistory: [],
    goBack: vi.fn(),
    goForward: vi.fn(),
    goToHistoryIndex: vi.fn(),
  }),
  useNavigationInputBindings: () => {},
}));

vi.mock("@/platform/navigation", () => ({
  DesktopNavigationProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  routeContentLinkPath: vi.fn(),
}));

vi.mock("@auro/core/paths", () => ({
  WorkspaceSlugProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  paths: { workspace: () => ({ inbox: () => "/acme/inbox" }) },
  useCurrentWorkspace: () => null,
}));

vi.mock("@auro/core/platform", () => ({
  getCurrentSlug: () => state.currentSlug,
  subscribeToCurrentSlug: () => () => {},
}));

vi.mock("@auro/core/workspace", () => ({
  workspaceListOptions: () => ({
    queryKey: ["workspace-list"],
    queryFn: async () => state.wsList,
  }),
}));

vi.mock("@auro/views/navigation", () => ({
  useNavigation: () => ({ push: vi.fn() }),
}));

vi.mock("@auro/views/platform", () => ({
  useDesktopUnreadBadge: () => {},
}));

// Each workspace-scoped component gets a marker so the assertions can tell
// which of them the shell decided to mount.
vi.mock("@auro/views/layout", () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
  GlobalShortcuts: () => <div data-testid="global-shortcuts" />,
  NavigationProgress: () => <div data-testid="navigation-progress" />,
}));

vi.mock("@auro/views/modals/registry", () => ({
  ModalRegistry: () => <div data-testid="modal-registry" />,
}));

// Stands in for the real SearchCommand, which calls useWorkspaceId() at the
// top of its body. Mounting it without a resolvable workspace is precisely
// the crash this gate prevents, so the stub throws the same way.
vi.mock("@auro/views/search", () => ({
  SearchCommand: () => {
    const resolved = state.wsList.some((w) => w.slug === state.currentSlug);
    if (!resolved) {
      throw new Error(
        "useWorkspaceId: no workspace selected — ensure component renders inside a workspace route",
      );
    }
    return <div data-testid="search-command" />;
  },
  SearchTrigger: () => null,
}));

vi.mock("./tab-bar", () => ({ TabBar: () => null }));
vi.mock("./window-overlay", () => ({ WindowOverlay: () => null }));
vi.mock("./tab-content", () => ({
  TabContent: () => <div data-testid="tab-content" />,
}));

const { DesktopShell } = await import("./desktop-layout");

function renderShell() {
  (
    window as unknown as { desktopAPI: Record<string, unknown> }
  ).desktopAPI = {
    onNavigationGesture: () => () => {},
    onInboxOpen: () => () => {},
  };

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  qc.setQueryData(["workspace-list"], state.wsList);

  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en" resources={RESOURCES}>
        <DesktopShell />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  });
  localStorage.clear();
  state.currentSlug = "acme";
  state.wsList = [{ id: "ws-1", slug: "acme" }];
});

describe("DesktopShell workspace gating", () => {
  it("mounts workspace-scoped chrome while the slug resolves", () => {
    const { queryByRole, queryByTestId } = renderShell();

    expect(queryByTestId("app-sidebar")).not.toBeNull();
    expect(queryByTestId("search-command")).not.toBeNull();
    expect(queryByTestId("global-shortcuts")).not.toBeNull();
    expect(queryByTestId("modal-registry")).not.toBeNull();
    expect(queryByRole("status", { name: /loading workspace/i })).toBeNull();
  });

  it("keeps traffic-light clearance and a loading shell while the slug is unresolved", () => {
    state.currentSlug = null;

    const { container, getByRole, getByTestId, queryByTestId } = renderShell();

    expect(queryByTestId("app-sidebar")).toBeNull();
    expect(
      container.querySelectorAll("[data-slot='sidebar-trigger']"),
    ).toHaveLength(0);
    expect(
      container.querySelector('[data-slot="main-top-bar"]'),
    ).toHaveStyle({ paddingLeft: "200px" });
    expect(
      getByRole("status", { name: /loading workspace/i }),
    ).toBeVisible();
    expect(getByTestId("tab-content")).toBeInTheDocument();
  });

  it("drops workspace-scoped chrome when the singleton still points at a deleted workspace", () => {
    // Exactly the post-delete window: the list refetch has landed empty, but
    // nothing has cleared the slug singleton yet.
    state.wsList = [];

    const { queryByTestId } = renderShell();

    expect(queryByTestId("app-sidebar")).toBeNull();
    expect(queryByTestId("search-command")).toBeNull();
    expect(queryByTestId("global-shortcuts")).toBeNull();
    expect(queryByTestId("modal-registry")).toBeNull();
    expect(queryByTestId("tab-content")).not.toBeNull();
  });

  it("keeps TabContent mounted with no workspace so the tab router can still resolve one", () => {
    state.wsList = [];

    const { queryByTestId } = renderShell();

    expect(queryByTestId("tab-content")).not.toBeNull();
  });

  // The shell had no navigation feedback at all before MUL-6404 — the bar
  // only ever shipped inside web's DashboardLayout. It sits beside TabContent
  // in the canvas and, like it, is not workspace-gated: a cold workspace
  // resolve is exactly when the wait is longest.
  it("mounts the navigation progress bar, workspace or not", () => {
    expect(renderShell().queryByTestId("navigation-progress")).not.toBeNull();

    cleanup();
    state.wsList = [];

    expect(renderShell().queryByTestId("navigation-progress")).not.toBeNull();
  });

  it("drops chrome for a slug belonging to a workspace the user lost access to", () => {
    state.currentSlug = "gone";
    state.wsList = [{ id: "ws-1", slug: "acme" }];

    const { queryByTestId } = renderShell();

    expect(queryByTestId("app-sidebar")).toBeNull();
    expect(queryByTestId("search-command")).toBeNull();
  });
});
