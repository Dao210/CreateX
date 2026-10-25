import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithI18n } from "../test/i18n";
import { TankGarage } from "./tank-garage";
import { TankCharacterEditor } from "./tank-character-editor";

const mocks = vi.hoisted(() => ({ list: vi.fn(), session: vi.fn(), save: vi.fn(), replace: vi.fn() }));
vi.mock("@auro/core/api", async importOriginal => ({ ...await importOriginal<typeof import("@auro/core/api")>(), api: { listTankCharacters: mocks.list, getTankSession: mocks.session, saveTankCharacter: mocks.save, getBaseUrl: () => "https://api.example.invalid" } }));
vi.mock("../navigation", () => ({ useNavigation: () => ({ searchParams: new URLSearchParams("session=11111111-1111-4111-8111-111111111111"), replace: mocks.replace, getShareableUrl: (path: string) => `https://auro.example.invalid${path}` }) }));
function render(ui: React.ReactElement) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); return renderWithI18n(<QueryClientProvider client={client}>{ui}</QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([]); });

it("shows a failed session without silently substituting a classic battle", async () => {
  mocks.session.mockRejectedValue(new Error("not_found"));
  render(<TankGarage workspace={{ id: "workspace", slug: "acme" }} userId="user" storageKey="test" storage={{ getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("This session could not be loaded");
  expect(screen.queryByTestId("tank-battlefield")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Return to classic tank" })); expect(mocks.replace).toHaveBeenCalledWith("/acme/tanks");
});

it("preserves a failed editor draft and retries the same intended save", async () => {
  mocks.save.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce({ id: "saved" });
  const saved = vi.fn();
  render(<TankCharacterEditor workspaceId="workspace" open onOpenChange={vi.fn()} character={null} onSaved={saved} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Tank name" }), { target: { value: "My forest tank" } });
  fireEvent.click(screen.getByRole("button", { name: "Save character" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your selection is preserved");
  expect(screen.getByRole("textbox", { name: "Tank name" })).toHaveValue("My forest tank");
  fireEvent.click(screen.getByRole("button", { name: "Save character" })); await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(mocks.save.mock.calls[1]![1].requestId).toBe(mocks.save.mock.calls[0]![1].requestId);
});
