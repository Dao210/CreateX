import type { InboxItem } from "@auro/core/types";
import { inboxContent, type InboxCategory, type InboxContent, type InboxEntry } from "@auro/core/inbox/messages";
import { useT } from "../../i18n";

export function useInboxCopy() {
  const { t, i18n } = useT("inbox");
  const title = (item: InboxItem) => {
    if (item.type === "world_digest") return t($ => $.messages.world_digest);
    const entry = inboxContent(item)?.entries[0];
    if (entry && item.type === "creation_ready") return entry.kind === "tank_updated"
      ? t($ => $.messages.creation_updated, { name: entry.name })
      : t($ => $.messages.creation_ready, { name: entry.name });
    if (entry && item.type === "character_milestone") return t($ => $.messages.character_milestone, { name: entry.name, level: entry.level });
    return item.title;
  };
  const entryText = (entry: InboxEntry) => {
    if (entry.kind === "resident_goal_reached") return entry.goalKind === "wood"
      ? t($ => $.messages.resident_wood, { name: entry.name, target: entry.target })
      : t($ => $.messages.resident_coins, { name: entry.name, target: entry.target });
    if (entry.kind === "tank_created") return t($ => $.messages.tank_created, { name: entry.name });
    if (entry.kind === "tank_updated") return t($ => $.messages.tank_updated, { name: entry.name, revision: entry.revision });
    return t($ => $.messages.tank_level_up, { name: entry.name, level: entry.level });
  };
  const summary = (content: InboxContent) => [
    content.totals.created > 0 ? t($ => $.messages.created, { count: content.totals.created }) : "",
    content.totals.updated > 0 ? t($ => $.messages.updated, { count: content.totals.updated }) : "",
    content.totals.milestones > 0 ? t($ => $.messages.milestones, { count: content.totals.milestones }) : "",
    (content.totals.residents ?? 0) > 0 ? t($ => $.messages.residents, { count: content.totals.residents }) : "",
  ].filter(Boolean).join(" · ");
  const categoryLabel = (category: InboxCategory) => {
    switch (category) {
      case "all": return t($ => $.messages.all);
      case "creations": return t($ => $.messages.creations);
      case "world": return t($ => $.messages.world);
      case "system": return t($ => $.messages.system);
    }
  };
  const time = (at: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
  return { title, entryText, summary, categoryLabel, time };
}
