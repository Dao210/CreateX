import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../test/i18n";
import { makeBaselineStrategy } from "@auro/core/capture-the-flag";
const mock = vi.hoisted(() => ({ enroll: vi.fn(), save: vi.fn() }));
const ws = "00000000-0000-4000-8000-000000000001",
  user = "00000000-0000-4000-8000-000000000002";
const record = {
  id: "00000000-0000-4000-8000-000000000003",
  workspaceId: ws,
  ownerId: user,
  ownerName: "Author",
  name: "Scout",
  revision: 3,
  hash: "a".repeat(64),
  published: false,
  archived: false,
  createdAt: new Date().toISOString(),
};
vi.mock("@auro/core/capture-the-flag", async () => ({
  ...(await vi.importActual("@auro/core/capture-the-flag")),
  ctfStateOptions: () => ({
    queryKey: ["ctf", "test"],
    queryFn: async () => ({
      workspaceId: ws,
      canManage: false,
      mine: [record],
      library: [],
      entries: [],
      batches: [],
      matches: [],
      leaderboard: [],
    }),
  }),
  useCTFStrategyLoader: () => async () => ({
    ...record,
    strategy: makeBaselineStrategy("scout", "Scout", "red"),
  }),
  useCTFActions: () => ({
    save: { mutateAsync: mock.save },
    enroll: { mutateAsync: mock.enroll },
    archive: {},
    withdraw: {},
    start: {},
    control: {},
  }),
}));
vi.mock("@auro/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: ws, slug: "test" }),
  useWorkspacePaths: () => ({ ctf: () => "/test/ctf", me: () => "/test/me" }),
}));
vi.mock("@auro/core/auth", () => ({
  useAuthStore: Object.assign(
    (select: (s: unknown) => unknown) => select({ user: { id: user } }),
    { getState: () => ({ user: { id: user } }) },
  ),
}));
vi.mock("../admin/game-access-boundary", () => ({
  GameAccessBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../navigation", () => ({
  AppLink: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useNavigation: () => ({
    pathname: "/test/ctf",
    searchParams: new URLSearchParams(),
  }),
}));
vi.mock("./battle-canvas", () => ({
  BattleCanvas: () => <div data-testid="battle" />,
}));
import { CTFPage } from "./ctf-page";
function mount() {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithI18n(
    <QueryClientProvider client={query}>
      <CTFPage
        storage={{
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        }}
      />
    </QueryClientProvider>,
  );
}
describe("publication and frozen enrollment", () => {
  it("requires visible consent before publishing the saved revision", async () => {
    mock.enroll.mockResolvedValue({ ...record, published: true });
    mount();
    await screen.findByText("Scout");
    fireEvent.click(screen.getByRole("button", { name: "Enter arena" }));
    expect(mock.enroll).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/complete source of this version/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Publish and enter" }));
    await waitFor(() =>
      expect(mock.enroll).toHaveBeenCalledWith(
        expect.objectContaining({
          id: record.id,
          revision: 3,
          hash: record.hash,
          publish: true,
        }),
      ),
    );
  });
});
