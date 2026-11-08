import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const mocks = vi.hoisted(() => ({ replace: vi.fn(), query: new URLSearchParams(), user: {} as object | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => mocks.query }));
vi.mock("@auro/core/auth", () => ({ useAuthStore: (selector: (state: { user: object | null; isLoading: boolean }) => unknown) => selector({ user: mocks.user, isLoading: false }) }));
vi.mock("@auro/views/onboarding", () => ({ OnboardingFlow: ({ onComplete }: { onComplete: (world: { slug: string }) => void }) => <button onClick={() => onComplete({ slug: "my-world" })}>Enter world</button> }));
beforeEach(() => { mocks.replace.mockClear(); mocks.query = new URLSearchParams(); mocks.user = {}; });
afterEach(cleanup);
it.each([["tank", "tanks"], ["fish", "fish"], ["resident", "life"]])("enters the requested %s creation after the world is ready", (creation, feature) => {
  mocks.query.set("creation", creation); render(<Page />); fireEvent.click(screen.getByRole("button"));
  expect(mocks.replace).toHaveBeenCalledWith(`/my-world/${feature}?create=1`);
});
it("keeps ordinary onboarding on My Creations", () => {
  mocks.query.set("creation", "https://evil.test"); render(<Page />); fireEvent.click(screen.getByRole("button"));
  expect(mocks.replace).toHaveBeenCalledWith("/my-world/me");
});
it("preserves a valid creation when authentication is needed", async () => {
  mocks.user = null; mocks.query.set("creation", "fish"); render(<Page />);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2Fonboarding%3Fcreation%3Dfish"));
});
