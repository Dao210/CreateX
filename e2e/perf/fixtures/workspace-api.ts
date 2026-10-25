import type { BrowserContext } from "@playwright/test";
import * as fx from "./typing-under-live-runs";

export const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const workspace = {
  id: fx.WORKSPACE_ID, name: "Perf", slug: fx.WORKSPACE_SLUG,
  description: null, context: null,
  settings: { github_enabled: false }, repos: [],
  issue_prefix: "PERF", avatar_url: null,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};

const me = {
  id: fx.USER_ID, name: "Perf User", email: "perf@example.test", avatar_url: null,
  language: null, onboarded_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: { source: "other" },
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};

const issue = {
  id: fx.ISSUE_ID, workspace_id: fx.WORKSPACE_ID, number: 1,
  identifier: fx.ISSUE_IDENTIFIER, title: "Typing under live runs",
  description: "Performance scenario fixture.", status: "in_progress",
  status_category: "in_progress", status_name: "In Progress", priority: "none",
  assignee_type: null, assignee_id: null, creator_type: "user", creator_id: fx.USER_ID,
  parent_issue_id: null, project_id: null, position: 0,
  start_date: null, due_date: null, stage: null, metadata: {}, properties: {},
  labels: [], reactions: [],
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};

/**
 * Every request the page is allowed to make. Anything else invalidates the
 * sample: a business call answered by a catch-all would quietly change what is
 * being measured.
 */
export function responseFor(pathname: string): unknown | undefined {
  const messages = /^\/api\/tasks\/([0-9a-f-]+)\/messages$/.exec(pathname);
  if (messages) {
    const index = fx.runIds.indexOf(messages[1]!);
    return index >= 0 ? fx.buildInitialMessages(index) : undefined;
  }
  switch (pathname) {
    case "/api/config": return { feature_flags: {}, allow_signup: true };
    case "/api/me": return me;
    case "/api/admin/access": return { isAdmin: false, configured: false };
    case "/api/workspaces": return [workspace];
    case "/api/client-usage": return {};
    case "/api/agents": case "/api/runtimes": case "/api/squads":
    case "/api/agent-task-snapshot": case "/api/invitations": case "/api/inbox":
    case "/api/inbox/unread-summary": case "/api/pins": case "/api/chat/sessions":
      return [];
    case "/api/tanks/v1/characters": return { characters: [] };
    case "/api/chat/pending-tasks": return { tasks: [] };
    case "/api/chat/pinned-agents": return [];
    case `/api/workspaces/${fx.WORKSPACE_ID}/members`: return [];
    case "/api/projects": return { projects: [], total: 0 };
    case "/api/issues": return { issues: [], total: 0 };
    case "/api/issue-statuses": return { statuses: [] };
    case "/api/properties": return { properties: [], total: 0 };
    case "/api/labels": return { labels: [], groups: [] };
    case "/api/search-index/manifest": return { cursor: "perf-empty", issue_count: 0, comment_count: 0, project_count: 0, text_bytes: 0 };
    case "/api/search-index/snapshot": return { issues: [], comments: [], projects: [], next_after_number: 0, done: true };
    case "/api/search-index/changes": return { issues: [], comments: [], projects: [], deleted: { issues: [], comments: [], projects: [] }, cursor: "perf-empty", has_more: false };
    case "/api/quick-actions": return { quick_actions: [] };
    case "/api/assignee-frequency": return [];
    // Typing debounces a trigger preview. It is part of the cost being
    // measured, so it is answered rather than blocked.
    case `/api/issues/${fx.ISSUE_ID}/comments/trigger-preview`:
      return { agents: [], blocked: [] };
    case "/api/issues/child-progress": return { progress: [] };
    case `/api/issues/${fx.ISSUE_IDENTIFIER}`:
    case `/api/issues/${fx.ISSUE_ID}`: return issue;
    case `/api/issues/${fx.ISSUE_ID}/timeline`: return fx.buildTimelineEntries();
    case `/api/issues/${fx.ISSUE_ID}/task-runs`: return fx.buildTaskRuns();
    case `/api/issues/${fx.ISSUE_ID}/subscribers`:
    case `/api/issues/${fx.ISSUE_ID}/system-wakeups`:
    case `/api/issues/${fx.ISSUE_ID}/wakeups`:
    case `/api/issues/${fx.ISSUE_ID}/attachments`: return [];
    case `/api/issues/${fx.ISSUE_ID}/labels`: return { labels: [] };
    case `/api/issues/${fx.ISSUE_ID}/children`: return { issues: [] };
    case `/api/issues/${fx.ISSUE_ID}/duplicates`: return { duplicate_of: null, duplicates: [] };
    case `/api/issues/${fx.ISSUE_ID}/pull-requests`: return { pull_requests: [] };
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
