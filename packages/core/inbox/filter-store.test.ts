// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMPTY_INBOX_FILTERS, inboxActorKey } from "./filter-store";
describe("message actors", () => {
 it("uses a shared key for system messages and a stable key for members", () => {
  expect(inboxActorKey({ actor_type: "system", actor_id: null } as never)).toBe("system");
  expect(inboxActorKey({ actor_type: "member", actor_id: "u" } as never)).toBe("member:u");
  expect(inboxActorKey({ actor_type: null, actor_id: null } as never)).toBeNull();
  expect(EMPTY_INBOX_FILTERS).toEqual({ actors: [], unreadOnly: false });
 });
});
