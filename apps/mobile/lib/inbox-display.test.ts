import { describe, expect, it } from "vitest";
import type { InboxItem } from "@auro/core/types";
import { getAutopilotQuotaBody, getInboxDisplayTitle } from "./inbox-display";

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: "inbox-1",
    workspace_id: "workspace-1",
    recipient_type: "member",
    recipient_id: "member-1",
    actor_type: "agent",
    actor_id: "agent-1",
    type: "new_comment",
    severity: "info",
    title: "Issue title",
    body: null,
    read: false,
    archived: false,
    created_at: "2026-06-15T08:00:00Z",
    details: null,
    ...overrides,
  };
}

describe("deduplicateInboxItems", () => {
});

describe("getInboxDisplayTitle", () => {
  it("uses the same stable quota title as web instead of backend fallback copy", () => {
    expect(
      getInboxDisplayTitle(
        item({
          type: "autopilot_quota_exceeded",
          title: "Autopilot quota exceeded (100/100)",
        }),
      ),
    ).toBe("Autopilot run limit reached");
  });

  it("keeps paused autopilot copy on the server fallback path", () => {
    expect(
      getInboxDisplayTitle(
        item({
          type: "autopilot_paused",
          title: "Paused after repeated failures",
        }),
      ),
    ).toBe("Paused after repeated failures");
  });
});

describe("getInboxNavigationTarget", () => {
});

describe("getAutopilotQuotaBody", () => {
  it("formats the machine reset timestamp for the device locale", () => {
    const body = getAutopilotQuotaBody(
      item({
        type: "autopilot_quota_exceeded",
        body: "Raw fallback 2026-09-01T00:00:00Z",
        details: {
          limit: "100",
          reset_at: "2026-09-01T00:00:00Z",
          autopilot_title: "Daily triage",
        },
      }),
    );

    expect(body).toContain("Daily triage");
    expect(body).toContain("limit of 100 runs");
    expect(body).not.toContain("2026-09-01T00:00:00Z");
  });

  it("keeps the server fallback when structured facts are incomplete", () => {
    expect(
      getAutopilotQuotaBody(
        item({
          type: "autopilot_quota_exceeded",
          body: "Readable server fallback",
          details: { limit: "100" },
        }),
      ),
    ).toBe("Readable server fallback");
  });
});
