import type { InboxItem } from "@auro/core/types";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";

export function InboxDetailLabel({ item }: { item: InboxItem; className?: string }) {
  const { t } = useT("inbox");
  return <Text className="text-xs text-muted-foreground">{item.type === "autopilot_quota_exceeded" ? t("type.autopilot_quota_exceeded") : item.body}</Text>;
}
