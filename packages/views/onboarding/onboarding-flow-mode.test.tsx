import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@auro/core/i18n/react";
import enCommon from "../locales/en/common.json";
import enOnboarding from "../locales/en/onboarding.json";
import enWorkspace from "../locales/en/workspace.json";

const TEST_RESOURCES = {
  en: { common: enCommon, onboarding: enOnboarding, workspace: enWorkspace },
};

const firstRun = vi.hoisted(() => ({ name: "Ada", prepare: vi.fn() }));

beforeEach(() => {
  firstRun.name = "Ada";
  firstRun.prepare.mockClear();
});

vi.mock("../auth", () => ({ useLogout: () => vi.fn() }));

vi.mock("@auro/core/config", () => ({
  useConfigStore: (
    selector: (s: { workspaceCreationDisabled: boolean; daemonAppUrl: string }) => unknown,
  ) => selector({ workspaceCreationDisabled: false, daemonAppUrl: "" }),
}));

vi.mock("@auro/core/api", () => ({
  api: { getBaseUrl: () => "https://auro.ai" },
}));

vi.mock("@auro/core/workspace/mutations", () => ({
  useCreateWorkspace: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@auro/core/auth", () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: unknown }) => unknown) =>
      selector({ user: { id: "u-1", name: firstRun.name, onboarding_questionnaire: {} } }),
    { getState: () => ({ user: { id: "u-1" } }) },
  ),
}));

// Returning one workspace proves new-workspace mode does not offer to
// continue with it.
vi.mock("@auro/core/workspace", () => {
  return {
    useWorkspaceList: () => ({
      workspaces: [{ id: "ws-1", name: "Existing", slug: "existing" }],
      ready: true,
    }),
  };
});

vi.mock("@auro/core/onboarding", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@auro/core/onboarding",
  );
  return {
    ...actual,
    useBootstrapMika: () => ({ mutateAsync: vi.fn() }),
    useCivilizationOnboarding: (identity: { name: string; slug: string }) => {
      firstRun.prepare(identity);
      return { stage: "loading", workspace: null, error: null, retry: vi.fn() };
    },
  };
});

import { OnboardingFlow } from "./onboarding-flow";

function renderFlow(props: Record<string, unknown>) {
  return render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <OnboardingFlow onComplete={vi.fn()} {...props} />
    </I18nProvider>,
  );
}

describe("OnboardingFlow — new-workspace mode", () => {
  it("starts at the workspace step instead of the product intro", () => {
    renderFlow({ mode: "new_workspace", onCancel: vi.fn() });

    // The welcome screen teaches what Auro is; someone creating a second
    // workspace already knows, so the flow opens on naming it.
    expect(
      screen.getByRole("heading", { name: /Name your world/i }),
    ).toBeInTheDocument();
  });

  it("always creates a workspace rather than offering the existing one", () => {
    renderFlow({ mode: "new_workspace", onCancel: vi.fn() });

    // First-run onboarding offers "Continue with {name}" when an abandoned
    // workspace exists. Doing that here would defeat the whole intent.
    expect(screen.queryByText(/Continue with/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("World name")).toBeInTheDocument();
  });

  it("opens the civilization loading page in first-run mode", () => {
    renderFlow({});

    expect(screen.getByRole("heading", { name: "Your world" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing your world");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("names the first world from the nickname once, keeping its address and name on rerender", () => {
    const view = renderFlow({});
    const identity = firstRun.prepare.mock.calls[0]![0];
    expect(identity.name).toBe("Ada’s world");
    expect(identity.slug).toMatch(/^[a-z0-9-]+-[a-z0-9]{4}$/);
    firstRun.name = "Grace";
    view.rerender(<I18nProvider locale="en" resources={TEST_RESOURCES}><OnboardingFlow onComplete={vi.fn()} /></I18nProvider>);
    expect(firstRun.prepare).toHaveBeenLastCalledWith(identity);
  });

  it("uses a localized world name when the account has no nickname", () => {
    firstRun.name = "   ";
    renderFlow({});
    expect(firstRun.prepare.mock.calls[0]![0].name).toBe("My world");
  });
});
