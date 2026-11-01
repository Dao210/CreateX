/**
 * Inbox title display helpers.
 *
 * Mirrors packages/views/inbox/components/inbox-display.ts. Keeping behavior
 * identical is required by apps/mobile/CLAUDE.md "Behavioral parity":
 * the title a user sees in the mobile inbox MUST match what they see on
 * web for the same item. When the web version changes, sync this file.
 */
import { inboxContent, type InboxContent, type InboxEntry } from "@auro/core/inbox/messages";
import { isVisibleInboxItem } from "@auro/core/inbox/system-notifications";
import type { InboxItem } from "@auro/core/types";
import { i18n } from "@/lib/i18n/singleton";

function formatResetAt(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function getAutopilotQuotaBody(item: InboxItem): string | null {
  if (item.type !== "autopilot_quota_exceeded") return item.body;
  const details = item.details ?? {};
  const resetAt = formatResetAt(details.reset_at);
  if (!details.limit || !resetAt) return item.body;
  const t = i18n.t.bind(i18n);
  if (details.autopilot_title) {
    return t("inbox:body.autopilot_title_limit", {
      title: details.autopilot_title,
      limit: details.limit,
      resetAt,
    });
  }
  return t("inbox:body.autopilot_limit", {
    limit: details.limit,
    resetAt,
  });
}

export function getInboxDisplayTitle(item: InboxItem): string {
  const entry = inboxContent(item)?.entries[0];
  if (item.type === "world_digest") return i18n.t("inbox:messages.world_digest");
  if (entry && item.type === "creation_ready") return i18n.t(entry.kind === "tank_updated" ? "inbox:messages.creation_updated" : "inbox:messages.creation_ready", { name: entry.name });
  if (entry && item.type === "character_milestone") return i18n.t("inbox:messages.character_milestone", { name: entry.name, level: entry.level });
  // Resolve system-notice titles through the selected UI locale. Mirror
  // rather than exposing backend fallback copy that can include raw counts.
  switch (item.type) {
    case "autopilot_quota_exceeded":
      return i18n.t("inbox:type.autopilot_quota_exceeded");
  }
  return item.title;
}

export function getInboxNavigationTarget(
  item: InboxItem,
  workspace: string | null,
  historyToken: string,
) {
  if (!workspace) return null;
  if (
    isVisibleInboxItem(item)
  ) {
    return {
      pathname: "/[workspace]/inbox/[id]" as const,
      params: { workspace, id: item.id },
    };
  }
  return null;
}

/** Active messages match the web list; each notice owns its own identity. */
export function deduplicateInboxItems(items: InboxItem[]): InboxItem[] {
  return items.filter((item) => !item.archived);
}

export function getInboxEntryText(entry: InboxEntry): string {
  if (entry.kind === "resident_goal_reached") return i18n.t(entry.goalKind === "wood" ? "inbox:messages.resident_wood" : "inbox:messages.resident_coins", { name: entry.name, target: entry.target });
  if (entry.kind === "tank_created") return i18n.t("inbox:messages.tank_created", { name: entry.name });
  if (entry.kind === "tank_updated") return i18n.t("inbox:messages.tank_updated", { name: entry.name, revision: entry.revision });
  return i18n.t("inbox:messages.tank_level_up", { name: entry.name, level: entry.level });
}
export function getInboxSummary(content: InboxContent): string {
  return [content.totals.created ? i18n.t("inbox:messages.created", { count: content.totals.created }) : "",
    content.totals.updated ? i18n.t("inbox:messages.updated", { count: content.totals.updated }) : "",
    content.totals.milestones ? i18n.t("inbox:messages.milestones", { count: content.totals.milestones }) : "",
    content.totals.residents ? i18n.t("inbox:messages.residents", { count: content.totals.residents }) : ""].filter(Boolean).join(" · ");
}
