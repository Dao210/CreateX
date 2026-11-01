// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDetailItem } from "./inbox-display";
import type { InboxItem } from "@auro/core/types";
const item = (overrides: Partial<InboxItem>) => ({ read: false, archived: false, ...overrides } as InboxItem);
describe("resolveDetailItem", () => {
  // Rows the inbox keys by issue_id, plus one plain notification that has none
  // and is therefore keyed by its own id.
  const a = item({ id: "inbox-a", issue_id: "inbox-a" });
  const b = item({ id: "inbox-b", issue_id: "inbox-b" });
  const plain = item({ id: "inbox-plain", issue_id: null });
  const list = [a, b, plain];

  it("holds the row the pane is still on while the list has moved on", () => {
    expect(resolveDetailItem(list, "inbox-b", "inbox-a")).toBe(a);
  });

  it("shows the live selection once the pane has caught up", () => {
    expect(resolveDetailItem(list, "inbox-b", "inbox-b")).toBe(b);
  });

  // Archive moves the selection to the neighbour and drops the actioned row in
  // the same commit, so the deferred key resolves to nothing. Holding that miss
  // would blink the empty state between the two issues.
  it("falls forward to the live selection when the held row is gone", () => {
    expect(resolveDetailItem([b, plain], "inbox-b", "inbox-a")).toBe(b);
  });

  it("stays empty while the first selection is still rendering", () => {
    expect(resolveDetailItem(list, "inbox-a", "")).toBeNull();
  });

  it("stays empty when the selection is cleared and the pane agrees", () => {
    expect(resolveDetailItem(list, "", "")).toBeNull();
  });

  // Deep link to a notification that is not in this user's inbox: the page
  // redirects to the issue page, and the pane must not invent a row meanwhile.
  it("resolves nothing when neither key is in the list", () => {
    expect(resolveDetailItem(list, "issue-gone", "issue-also-gone")).toBeNull();
  });
});
