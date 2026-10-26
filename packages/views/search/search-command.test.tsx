import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { paths } from "@auro/core/paths";
import { renderWithI18n } from "../test/i18n";
import { useSearchStore } from "./search-store";
import { SearchCommand } from "./search-command";

const state = vi.hoisted(() => ({
  navigate: vi.fn(), setTheme: vi.fn(), searchIssues: vi.fn(), searchProjects: vi.fn(),
  queries: [] as { queryKey: readonly unknown[]; enabled?: boolean }[],
  members: [] as { user_id: string; name: string; email: string; role: string; avatar_url: null }[],
}));
vi.mock("@auro/core/hooks", () => ({ useWorkspaceId: () => "ws-test" }));
vi.mock("@auro/core/paths", async (original) => ({ ...(await original<typeof import("@auro/core/paths")>()), useWorkspacePaths: () => paths.workspace("acme") }));
vi.mock("../navigation", async (original) => ({ ...(await original<typeof import("../navigation")>()), useIntentNavigate: () => state.navigate }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => { state.queries.push(options); return { data: state.members }; } }));
vi.mock("@auro/core/workspace/queries", () => ({ memberListOptions: () => ({ queryKey: ["members", "ws-test"] }) }));
vi.mock("@auro/core/workspace/avatar-url", () => ({ resolvePublicFileUrl: (url: string | null) => url }));
vi.mock("@auro/core/search-index", () => ({ searchIssues: state.searchIssues, searchProjects: state.searchProjects }));
vi.mock("@auro/ui/components/common/theme-provider", () => ({ useTheme: () => ({ theme: "system", setTheme: state.setTheme }) }));
vi.mock("@auro/ui/components/common/actor-avatar", () => ({ ActorAvatar: () => <span /> }));

beforeEach(() => { vi.clearAllMocks(); state.queries = []; state.members = []; useSearchStore.setState({ open: true }); });

describe("workspace command search after route retirement", () => {
  it("offers remaining destinations without task/project actions or eager directory reads", () => {
    renderWithI18n(<SearchCommand />);
    expect(screen.queryByText("Issues")).not.toBeInTheDocument();
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    expect(screen.queryByText("Squads")).not.toBeInTheDocument();
    expect(screen.queryByText("New Issue")).not.toBeInTheDocument();
    expect(screen.queryByText("New Project")).not.toBeInTheDocument();
    expect(state.queries.every((query) => query.enabled === false)).toBe(true);
    expect(state.searchIssues).not.toHaveBeenCalled();
    expect(state.searchProjects).not.toHaveBeenCalled();
  });
  it("filters pages and navigates using the workspace path", async () => {
    renderWithI18n(<SearchCommand />);
    await userEvent.type(screen.getByPlaceholderText("Type a command or search..."), "tank");
    await userEvent.click(screen.getByRole("option", { name: "Tank Defense" }));
    expect(state.navigate).toHaveBeenCalledWith("/acme/tanks", "push");
    expect(useSearchStore.getState().open).toBe(false);
  });
  it("preserves modifier-click intent", async () => {
    renderWithI18n(<SearchCommand />);
    fireEvent.click(screen.getByRole("option", { name: "Tank Defense" }), { metaKey: true });
    expect(state.navigate).toHaveBeenCalledWith("/acme/tanks", "background-tab");
  });
  it("searches workspace members only after typing", async () => {
    state.members = [{ user_id: "user-1", name: "Alice", email: "alice@example.test", role: "member", avatar_url: null }];
    renderWithI18n(<SearchCommand />);
    await userEvent.type(screen.getByPlaceholderText("Type a command or search..."), "alice");
    await userEvent.click(screen.getByText("Alice"));
    expect(state.queries.some((query) => query.enabled === true)).toBe(true);
    expect(state.navigate).toHaveBeenCalledWith("/acme/members/user-1", "push");
  });
  it("keeps theme commands and Escape dismissal", async () => {
    renderWithI18n(<SearchCommand />);
    await userEvent.type(screen.getByPlaceholderText("Type a command or search..."), "dark");
    await userEvent.click(screen.getByRole("option", { name: "Switch to Dark Theme" }));
    expect(state.setTheme).toHaveBeenCalledWith("dark");
    expect(useSearchStore.getState().open).toBe(false);
  });
  it("closes on a single Escape press", async () => {
    renderWithI18n(<SearchCommand />);
    await userEvent.type(screen.getByPlaceholderText("Type a command or search..."), "{Escape}");
    expect(useSearchStore.getState().open).toBe(false);
  });
});
