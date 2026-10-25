// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isSystemInboxItem } from "./system-notifications";
import type { InboxItem } from "../types/inbox";

describe("system inbox scope", () => {
  it.each(["autopilot_paused", "autopilot_quota_exceeded"] as const)("keeps %s notices without task references", (type) => {
    expect(isSystemInboxItem({ type, issue_id: null })).toBe(true);
    expect(isSystemInboxItem({ type, issue_id: "retired-task" })).toBe(false);
  });
  it.each(["issue_assigned", "new_comment", "quick_create_done", "quick_create_failed", "quick_create_unconfirmed", "children_done"] as const)("excludes %s even when its task reference is absent", (type) => {
    expect(isSystemInboxItem({ type, issue_id: null })).toBe(false);
  });
  it("does not promote unknown notification types into actionable UI", () => {
    expect(isSystemInboxItem({ type: "future_type" as InboxItem["type"], issue_id: null })).toBe(false);
  });
});
