"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Archive, ArchiveRestore, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@auro/core/hooks";
import { useWorkspacePaths } from "@auro/core/paths";
import { inboxListOptions, archivedInboxPagesOptions, archivedInboxLookupOptions } from "@auro/core/inbox/queries";
import { EMPTY_INBOX_FILTERS } from "@auro/core/inbox/filter-store";
import { useMarkInboxRead, useMarkInboxUnread, useArchiveInbox, useUnarchiveInbox, useMarkAllInboxRead } from "@auro/core/inbox/mutations";
import { isSystemInboxItem } from "@auro/core/inbox/system-notifications";
import { Button } from "@auro/ui/components/ui/button";
import { cn } from "@auro/ui/lib/utils";
import { PageHeader, PAGE_GUTTER } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { AutopilotQuotaNotice } from "./autopilot-quota-notice";
import { useIssueLimitUpgradePrompt } from "../../modals/use-issue-limit-upgrade-prompt";

export function InboxPage() {
  const { t } = useT("inbox");
  const wsId = useWorkspaceId();
  const openQuotaRecovery = useIssueLimitUpgradePrompt("autopilot_quota");
  const paths = useWorkspacePaths();
  const { searchParams, replace } = useNavigation();
  const archived = searchParams.get("view") === "archived";
  const selectedKey = searchParams.get("issue") ?? "";
  const manuallyUnread = useRef<string | null>(null);
  const active = useQuery({ ...inboxListOptions(wsId), enabled: !archived });
  const archive = useInfiniteQuery({ ...archivedInboxPagesOptions(wsId, EMPTY_INBOX_FILTERS), enabled: archived });
  const loadedItems = useMemo(() => (archived ? archive.data?.pages.flatMap((page) => page.items) ?? [] : active.data ?? []).filter(isSystemInboxItem), [archived, archive.data, active.data]);
  const lookup = useQuery({ ...archivedInboxLookupOptions(wsId, selectedKey), enabled: archived && !!selectedKey && !loadedItems.some((item) => item.id === selectedKey) });
  const selected = loadedItems.find((item) => item.id === selectedKey) ?? lookup.data?.items.find((item) => item.id === selectedKey && isSystemInboxItem(item));
  const markRead = useMarkInboxRead();
  const markUnread = useMarkInboxUnread();
  const archiveItem = useArchiveInbox();
  const restoreItem = useUnarchiveInbox();
  const markAllRead = useMarkAllInboxRead();
  const pending = archived ? archive.isLoading : active.isLoading;
  const error = archived ? archive.error : active.error;
  const markReadMutate = markRead.mutate;

  const select = (id: string, nextArchived = archived) => {
    const params = new URLSearchParams();
    if (nextArchived) params.set("view", "archived");
    if (id) params.set("issue", id);
    const suffix = params.toString();
    replace(paths.inbox() + (suffix ? `?${suffix}` : ""));
  };

  const selectedId = selected?.id;
  const selectedRead = selected?.read;
  useEffect(() => {
    if (selectedId && !selectedRead && manuallyUnread.current !== selectedId) markReadMutate(selectedId);
  }, [selectedId, selectedRead, markReadMutate]);

  const mutationError = (cause: Error) => toast.error(cause.message);
  const retry = () => { void (archived ? archive.refetch() : active.refetch()); };

  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader>
      <h1 className="text-body font-medium">{t(($) => $.page.title)}</h1>
      <div className="ml-auto flex items-center gap-2">
        {!archived && <Button variant="ghost" size="icon-sm" aria-label={t(($) => $.menu.mark_all_read)} onClick={() => markAllRead.mutate(undefined, { onError: mutationError })}><CheckCheck /></Button>}
        <Button variant="ghost" size="sm" onClick={() => select("", !archived)}>{archived ? t(($) => $.page.back) : t(($) => $.list.archived_title)}</Button>
      </div>
    </PageHeader>
    <div className="flex min-h-0 flex-1">
      <div className={cn("w-full shrink-0 overflow-y-auto md:block md:w-80 md:border-r", selectedKey && "hidden")}>
        {pending && <p role="status" className="p-4 text-caption text-muted-foreground">{t(($) => $.list.loading_selection)}</p>}
        {error && <div className="p-4"><p className="text-caption text-destructive">{error.message}</p><Button variant="outline" size="sm" onClick={retry}>{t(($) => $.list.retry)}</Button></div>}
        {!pending && !error && loadedItems.length === 0 && <p className="p-4 text-caption text-muted-foreground">{archived ? t(($) => $.list.archived_empty) : t(($) => $.list.empty)}</p>}
        {loadedItems.map((item) => <button type="button" key={item.id} onClick={() => { manuallyUnread.current = null; select(item.id); }} className={cn("flex w-full flex-col gap-1 p-4 text-left hover:bg-accent", selectedKey === item.id && "bg-accent")} aria-current={selectedKey === item.id || undefined}>
          <span className={cn("text-body", !item.read && "font-semibold")}>{item.title}</span>
          <time className="text-caption text-muted-foreground" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
        </button>)}
        {archived && archive.hasNextPage && <Button className="m-4" variant="outline" size="sm" disabled={archive.isFetchingNextPage} onClick={() => { void archive.fetchNextPage(); }}>{archive.isFetchingNextPage ? t(($) => $.list.loading_more) : t(($) => $.list.load_more)}</Button>}
      </div>
      <div className={cn("min-w-0 flex-1 overflow-y-auto", !selectedKey && "hidden md:block")}>
        {selectedKey && <Button className="m-2 md:hidden" variant="ghost" size="sm" onClick={() => select("")}><ArrowLeft />{t(($) => $.page.back)}</Button>}
        {selected ? <article className={cn(PAGE_GUTTER, "py-6")}>
          <h2 className="text-title-sm font-semibold">{selected.title}</h2>
          {selected.type === "autopilot_quota_exceeded" ? <AutopilotQuotaNotice item={selected} onOpenRecovery={openQuotaRecovery} /> : selected.body && <p className="mt-4 whitespace-pre-wrap text-body leading-relaxed">{selected.body}</p>}
          <div className="mt-6 flex gap-2">
            <Button variant="outline" size="sm" disabled={archiveItem.isPending || restoreItem.isPending} onClick={() => {
              (archived ? restoreItem : archiveItem).mutate(selected.id, { onSuccess: () => select(""), onError: mutationError });
            }}>{archived ? <ArchiveRestore /> : <Archive />}{archived ? t(($) => $.detail.unarchive) : t(($) => $.detail.archive)}</Button>
            {!archived && <Button variant="ghost" size="sm" onClick={() => {
              if (selected.read) { manuallyUnread.current = selected.id; markUnread.mutate(selected.id, { onError: mutationError }); }
              else { manuallyUnread.current = null; markRead.mutate(selected.id, { onError: mutationError }); }
            }}>{selected.read ? t(($) => $.context_menu.mark_unread) : t(($) => $.context_menu.mark_read)}</Button>}
          </div>
        </article> : <p className="p-6 text-body text-muted-foreground">{lookup.isFetching ? t(($) => $.list.loading_selection) : t(($) => $.detail.select_prompt)}</p>}
      </div>
    </div>
  </div>;
}
