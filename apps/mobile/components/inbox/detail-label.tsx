import { inboxContent } from "@auro/core/inbox/messages";
import { getInboxSummary } from "@/lib/inbox-display";
import type { InboxItem } from "@auro/core/types";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";

export function InboxDetailLabel({ item }: { item: InboxItem; className?: string }) {
  const { t } = useT("inbox");
  const content = inboxContent(item);
  return <Text className="text-xs text-muted-foreground">{item.type === "world_digest" && content ? getInboxSummary(content) : item.type === "creation_ready" || item.type === "character_milestone" ? t("messages.creations") : item.type === "autopilot_quota_exceeded" ? t("type.autopilot_quota_exceeded") : item.body}</Text>;
}
