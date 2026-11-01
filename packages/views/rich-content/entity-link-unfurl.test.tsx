/**
 * Bare in-app entity URLs render as chips (MUL-5499).
 *
 * A project has no `MUL-123` shorthand — only a UUID and a free-text title — so
 * the link copied out of the app IS how people reference one. This fixture pins
 * the three conditions that decide whether such a link becomes a chip, because
 * each of them fails silently: an over-eager rule eats an author's link label,
 * and a cross-workspace unfurl replaces a working link with a chip that can
 * never resolve.
 *
 * The real RichLink / preprocessing pipeline is exercised; only the chips
 * themselves are stubbed, so the assertions are about which branch the renderer
 * took, not about chip internals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { NavigationProvider } from "../navigation/context";
import type { NavigationAdapter } from "../navigation/types";

beforeEach(() => {
});

vi.mock("../i18n", async () => {
  const editor = (await import("../locales/en/editor.json")).default;
  return {
    useT: () => ({
      t: (select: (bundle: typeof editor) => string) => select(editor),
    }),
    useTimeAgo: () => "just now",
  };
});

vi.mock("@auro/core/api", () => ({
  api: { getAttachmentTextContent: vi.fn() },
  PreviewTooLargeError: class extends Error {},
  PreviewUnsupportedError: class extends Error {},
}));

// Partial mock: only the workspace-context hooks are stubbed. The pure path
// helpers (isReservedSlug / isGlobalPath) stay real — the URL parser under test
// depends on the same reserved-slug list the backend enforces, and stubbing it
// would make the assertions meaningless.
vi.mock("@auro/core/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@auro/core/paths")>()),
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/acme/issues/${id}`,
    projectDetail: (id: string) => `/acme/projects/${id}`,
  }),
  useWorkspaceSlug: () => "acme",
}));

vi.mock("../editor/link-hover-card", () => ({
  useLinkHover: () => ({}),
  LinkHoverCard: () => null,
}));

import { RichContent } from "./rich-content";

const APP_ORIGIN = "https://app.auro.ai";
const PROJECT_ID = "8f14e45f-ceea-4d0e-a1a2-9b1c0d3e4f5a";

function adapter(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/",
    searchParams: new URLSearchParams(),
    hash: "",
    // The real platform adapters return an absolute URL; useAppOrigin derives
    // the deployment origin from it, and without that nothing is "in-app".
    getShareableUrl: (p) => `${APP_ORIGIN}${p}`,
  };
}

function renderContent(content: string) {
  return render(
    <NavigationProvider value={adapter()}>
      <RichContent content={content} />
    </NavigationProvider>,
  );
}

describe("bare entity URLs in readonly content", () => {

  it("leaves a link the author labelled alone", () => {
    // Replacing this with a chip would throw away "Roadmap" — the author said
    // what they wanted the link to read as.
    const { container, queryByTestId } = renderContent(
      `[Roadmap](${APP_ORIGIN}/acme/projects/${PROJECT_ID})`,
    );

    expect(queryByTestId("project-chip")).toBeNull();
    const anchor = container.querySelector("a");
    expect(anchor?.textContent).toBe("Roadmap");
  });

  it("leaves a link into another workspace as a plain link", () => {
    // The chip resolves its title in the CURRENT workspace, so unfurling here
    // would swap a working link for a permanently empty chip.
    const { container, queryByTestId } = renderContent(
      `${APP_ORIGIN}/other-ws/projects/${PROJECT_ID}`,
    );

    expect(queryByTestId("project-chip")).toBeNull();
    expect(
      container.querySelector(
        `a[href="${APP_ORIGIN}/other-ws/projects/${PROJECT_ID}"]`,
      ),
    ).not.toBeNull();
  });

  it("leaves an external URL as a plain link", () => {
    const { queryByTestId, container } = renderContent(
      `https://github.com/auro-ai/auro/pull/1`,
    );
    expect(queryByTestId("project-chip")).toBeNull();
    expect(queryByTestId("issue-chip")).toBeNull();
    expect(container.querySelector("a")).not.toBeNull();
  });
});
