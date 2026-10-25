/** @vitest-environment jsdom */
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiInstance } from "../api";
import type { ApiClient } from "../api/client";
import type { Workspace } from "../types";
import { configStore } from "../config";
import { workspaceKeys } from "../workspace/queries";
import { useCivilizationOnboarding } from "./use-civilization-onboarding";

const auth = vi.hoisted(() => ({
  user: { id: "user-1", onboarded_at: null as string | null },
  refreshMe: vi.fn(async () => undefined),
}));

vi.mock("../auth", () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof auth) => unknown) => selector(auth),
    { getState: () => auth },
  ),
}));

const identity = { name: "Sirius", slug: "sirius-abc123" };
const workspace: Workspace = {
  id: "ws-1", ...identity, description: null, context: null, settings: {}, repos: [],
  issue_prefix: "SIRI", avatar_url: null, created_at: "2026-10-24", updated_at: "2026-10-24",
};
const listWorkspaces = vi.fn();
const createWorkspace = vi.fn();
const markOnboardingComplete = vi.fn();
let queryClient: QueryClient;

function renderPreparation() {
  return renderHook(() => useCivilizationOnboarding(identity), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></StrictMode>
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: "user-1", onboarded_at: null };
  configStore.setState({ workspaceCreationDisabled: false });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  listWorkspaces.mockResolvedValue([]);
  createWorkspace.mockResolvedValue(workspace);
  markOnboardingComplete.mockResolvedValue({});
  auth.refreshMe.mockResolvedValue(undefined);
  setApiInstance({ listWorkspaces, createWorkspace, markOnboardingComplete } as unknown as ApiClient);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("civilization onboarding", () => {
  it("creates once under Strict Mode, seeds the cache, and completes before entering", async () => {
    const { result } = renderPreparation();
    await waitFor(() => expect(result.current.stage).toBe("ready"));
    expect(createWorkspace).toHaveBeenCalledExactlyOnceWith(identity);
    expect(markOnboardingComplete).toHaveBeenCalledExactlyOnceWith({
      completion_path: "workspace_ready", workspace_id: workspace.id,
    });
    expect(auth.refreshMe).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(workspaceKeys.list())).toEqual([workspace]);
    expect(result.current.workspace).toEqual(workspace);
  });

  it("reuses the authoritative workspace instead of creating another", async () => {
    listWorkspaces.mockResolvedValue([workspace]);
    const { result } = renderPreparation();
    await waitFor(() => expect(result.current.stage).toBe("ready"));
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(result.current.workspace).toEqual(workspace);
  });

  it("keeps loading until onboarding completion succeeds", async () => {
    let finish!: () => void;
    markOnboardingComplete.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result } = renderPreparation();
    await waitFor(() => expect(result.current.stage).toBe("entering"));
    expect(auth.refreshMe).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(result.current.stage).toBe("ready"));
  });

  it("does not create or complete when the workspace list is unavailable", async () => {
    listWorkspaces.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderPreparation();
    await waitFor(() => expect(result.current.stage).toBe("error"));
    expect(result.current.error).toBe("offline");
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
    listWorkspaces.mockResolvedValueOnce([workspace]);
    await act(async () => { await result.current.retry(); });
    expect(result.current.stage).toBe("ready");
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("retries completion with the workspace already created", async () => {
    markOnboardingComplete.mockRejectedValueOnce(new Error("try again"));
    const { result } = renderPreparation();
    await waitFor(() => expect(result.current.stage).toBe("error"));
    await act(async () => { await result.current.retry(); });
    expect(result.current.stage).toBe("ready");
    expect(createWorkspace).toHaveBeenCalledOnce();
    expect(markOnboardingComplete).toHaveBeenCalledTimes(2);
  });

  it("refetches after an ambiguous create failure so retry does not create twice", async () => {
    createWorkspace.mockRejectedValueOnce(new Error("response lost"));
    const { result } = renderPreparation();
    await waitFor(() => expect(result.current.stage).toBe("error"));
    listWorkspaces.mockResolvedValue([workspace]);
    await act(async () => { await result.current.retry(); });
    expect(result.current.stage).toBe("ready");
    expect(createWorkspace).toHaveBeenCalledOnce();
  });

  it("honors disabled workspace creation, while still allowing an existing workspace", async () => {
    configStore.setState({ workspaceCreationDisabled: true });
    const { result } = renderPreparation();
    await waitFor(() => expect(result.current.stage).toBe("blocked"));
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
    listWorkspaces.mockResolvedValue([workspace]);
    await act(async () => { await result.current.retry(); });
    expect(result.current.stage).toBe("ready");
  });

  it("opens an onboarded user's existing workspace without repeating completion", async () => {
    auth.user.onboarded_at = "2026-10-24";
    listWorkspaces.mockResolvedValue([workspace]);
    const { result } = renderPreparation();
    await waitFor(() => expect(result.current.stage).toBe("ready"));
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
  });

  it("does not continue preparation after leaving the page", async () => {
    let finish!: (value: Workspace[]) => void;
    listWorkspaces.mockImplementationOnce(() => new Promise<Workspace[]>((resolve) => { finish = resolve; }));
    const { unmount } = renderPreparation();
    await waitFor(() => expect(listWorkspaces).toHaveBeenCalledOnce());
    unmount();
    await act(async () => finish([]));
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
  });
});
