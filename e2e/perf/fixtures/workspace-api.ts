import type { BrowserContext } from "@playwright/test";
import * as fx from "./world";

export const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const workspace = {
  id: fx.WORKSPACE_ID, name: "Perf", slug: fx.WORKSPACE_SLUG,
  description: null, context: null,
  settings: { github_enabled: false }, repos: [], avatar_url: null,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};

const me = {
  id: fx.USER_ID, name: "Perf User", email: "perf@example.test", avatar_url: null,
  language: null, onboarded_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: { source: "other" },
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};

/**
 * Every request the page is allowed to make. Anything else invalidates the
 * sample: a business call answered by a catch-all would quietly change what is
 * being measured.
 */
export function responseFor(pathname: string): unknown | undefined {
  switch (pathname) {
    case "/api/config": return { feature_flags: {}, allow_signup: true };
    case "/api/me": return me;
    case "/api/admin/access": return { isAdmin: false, configured: false };
    case "/api/workspaces": return [workspace];
    case "/api/games": return { workspaceId: fx.WORKSPACE_ID, games: ["siege", "tanks", "life"].map(gameId => ({ gameId, available: true, visible: true, reason: "inherited" })) };
    case "/api/client-usage": return {};
    case "/api/agents": case "/api/runtimes":
    case "/api/agent-task-snapshot": case "/api/invitations": case "/api/inbox":
    case "/api/inbox/unread-summary": case "/api/pins": case "/api/chat/sessions":
      return [];
    case "/api/tanks/v1/characters": return { characters: [] };
    case "/api/game-progress": return { workspaceId: fx.WORKSPACE_ID, siege: null, tanks: null };
    case "/api/chat/pending-tasks": return { tasks: [] };
    case "/api/chat/pinned-agents": return [];
    case `/api/workspaces/${fx.WORKSPACE_ID}/members`: return [];
    case "/api/labels": return { labels: [], total: 0 };
    default: return undefined;
  }
}

export async function mockWorkspaceRequests(
  context: BrowserContext,
  origin: string,
  diagnostics: { unknownRequests: string[]; external: string[] },
) {
  const { unknownRequests, external } = diagnostics;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    // Optional host analytics are outside this fixture and never leave the browser.
    if (url.hostname === "www.googletagmanager.com") return route.abort();
    // Local builds may embed a separate API origin. Mock its API before the
    // external-resource guard so this fixture never depends on a real backend.
    if (!url.pathname.startsWith("/api/")) {
      if (url.origin !== origin) {
        external.push(url.href);
        return route.abort();
      }
      return route.continue();
    }
    const corsHeaders = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "content-type, authorization, x-workspace-id, x-workspace-slug",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders });
    const body = responseFor(url.pathname);
    if (body === undefined) {
      unknownRequests.push(`${route.request().method()} ${url.pathname}${url.search}`);
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ ...json(body), headers: corsHeaders });
  });

}
