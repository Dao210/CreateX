import { inboxContent } from "@auro/core/inbox/messages";
import { isVisibleInboxItem } from "@auro/core/inbox/system-notifications";
import { ActivityIndicator, Linking, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  resolveBillingRecovery,
  type BillingRecoveryKind,
} from "@auro/core/billing/recovery";
import { BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG } from "@auro/core/feature-flags";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { inboxListOptions } from "@/data/queries/inbox";
import {
  appConfigOptions,
  workspaceSubscriptionSummaryOptions,
} from "@/data/queries/billing";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";
import {
  getAutopilotQuotaBody,
  getInboxDisplayTitle,
  getInboxEntryText,
  getInboxSummary,
} from "@/lib/inbox-display";

function BillingRecovery({
  recovery,
  billingUrl,
}: {
  recovery: BillingRecoveryKind;
  billingUrl: string | null;
}) {
  const { t } = useT("inbox");
  switch (recovery) {
    case "checking":
      return <ActivityIndicator />;
    case "billing_disabled":
      return (
        <Text className="text-sm leading-5 text-muted-foreground">
          {t("detail.billing_disabled")}
        </Text>
      );
    case "contact_admin":
      return (
        <Text className="text-sm leading-5 text-muted-foreground">
          {t("detail.contact_admin")}
        </Text>
      );
    case "checkout":
    case "portal":
    case "billing":
    case "billing_unavailable":
      return billingUrl ? (
        <Button
          onPress={() => void Linking.openURL(billingUrl)}
          accessibilityLabel={t("detail.review_billing")}
        >
          <Text>{t("detail.review_billing")}</Text>
        </Button>
      ) : (
        <Text className="text-sm leading-5 text-muted-foreground">
          {t("detail.review_billing_web")}
        </Text>
      );
  }
}

export default function InboxNoticeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useT("inbox");
  const { data: items, isLoading } = useQuery(inboxListOptions(wsId));

  // Read the raw workspace-scoped cache: deduplication can replace a row,
  // but a sheet already opened for a specific notification must remain stable.
  const item = items?.find(
    (candidate) => candidate.id === id && candidate.workspace_id === wsId,
  );
  const isQuotaNotice = item?.type === "autopilot_quota_exceeded";
  const configQuery = useQuery({
    ...appConfigOptions(),
    enabled: isQuotaNotice,
  });
  const billingEnabled =
    configQuery.data?.feature_flags?.[
      BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG
    ] === true;
  const summaryQuery = useQuery(
    workspaceSubscriptionSummaryOptions(wsId, isQuotaNotice && billingEnabled),
  );
  const checkingConfig =
    isQuotaNotice && !configQuery.data && configQuery.isFetching;
  const recovery = resolveBillingRecovery({
    actions: summaryQuery.data?.availableActions,
    billingEnabled: checkingConfig || billingEnabled,
    loading:
      checkingConfig ||
      (billingEnabled &&
        !summaryQuery.data?.availableActions &&
        summaryQuery.isFetching),
  });
  const webUrl = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/+$/, "");
  const billingUrl =
    webUrl && wsSlug ? `${webUrl}/${wsSlug}/settings?tab=billing` : null;
  const content = item ? inboxContent(item) : null;
  const time = (value: string) => new Date(value).toLocaleString();
  const body = item ? getAutopilotQuotaBody(item) : null;

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center border-b border-border px-4 py-3">
        <Text className="flex-1 text-lg font-semibold text-foreground">
          {item ? getInboxDisplayTitle(item) : t("detail.notification")}
        </Text>
        <IconButton
          name="close"
          variant="secondary"
          className="size-7 rounded-full"
          onPress={() => router.back()}
          accessibilityLabel={t("detail.close")}
        />
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : !item ||
        !isVisibleInboxItem(item) ? (
        <View className="px-4 py-8">
          <Text className="text-sm text-muted-foreground text-center">
            {t("detail.unavailable")}
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-5 px-4 py-5"
          showsVerticalScrollIndicator={false}
        >
          {content && <View className="gap-4">
            {content.windowStart && content.windowEnd ? <Text className="text-xs text-muted-foreground">{t("messages.window", { start: time(content.windowStart), end: time(content.windowEnd) })}</Text> : null}
            {item.type === "world_digest" ? <Text className="text-base font-medium text-foreground">{getInboxSummary(content)}</Text> : null}
            {content.entries.map(entry => <View key={entry.id} className="gap-2 rounded-lg bg-secondary p-4">
              <Text className="text-base font-medium text-foreground">{getInboxEntryText(entry)}</Text>
              {item.type === "world_digest" && entry.authorName ? <Text className="text-xs text-muted-foreground">{t("messages.author", { name: entry.authorName })}</Text> : null}
              <Text className="text-xs text-muted-foreground">{time(entry.occurredAt)}</Text>
              {webUrl && wsSlug ? <Button variant="outline" onPress={() => void Linking.openURL(`${webUrl}/${encodeURIComponent(wsSlug)}/${entry.kind === "resident_goal_reached" ? "life?resident=" : "tanks?character="}${encodeURIComponent(entry.subjectId)}`)}><Text>{t("messages.view_web")}</Text></Button> : null}
            </View>)}
            {content.totalEntries > content.entries.length ? <Text className="text-sm text-muted-foreground">{t("messages.more", { count: content.totalEntries-content.entries.length })}</Text> : null}
            {content.entries.some(entry => entry.kind === "tank_level_up") ? <Text className="text-xs text-muted-foreground">{t("messages.personal_records")}</Text> : null}
          </View>}
          {body ? (
            <Text className="text-base leading-6 text-foreground">
              {body}
            </Text>
          ) : null}

          {isQuotaNotice ? (
            <BillingRecovery recovery={recovery} billingUrl={billingUrl} />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
