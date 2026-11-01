"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Archive, ArchiveRestore, CheckCheck, Globe2, Sparkles, Bell } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@auro/core/hooks";
import { useWorkspacePaths } from "@auro/core/paths";
import { inboxListOptions, archivedInboxPagesOptions, archivedInboxLookupOptions } from "@auro/core/inbox/queries";
import { EMPTY_INBOX_FILTERS } from "@auro/core/inbox/filter-store";
import { useMarkInboxRead, useMarkInboxUnread, useArchiveInbox, useUnarchiveInbox, useMarkAllInboxRead } from "@auro/core/inbox/mutations";
import { isVisibleInboxItem } from "@auro/core/inbox/system-notifications";
import { autopilotNoticeId, inboxCategory, inboxContent, parseInboxCategory, type InboxCategory } from "@auro/core/inbox/messages";
import { Button } from "@auro/ui/components/ui/button";
import { cn } from "@auro/ui/lib/utils";
import { PageHeader, PAGE_GUTTER } from "../../layout/page-header";
import { AppLink, useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { AutopilotQuotaNotice } from "./autopilot-quota-notice";
import { useAutopilotQuotaRecovery } from "../../modals/use-autopilot-quota-recovery";
import { InboxMessageContent } from "./inbox-message-content";
import { useInboxCopy } from "./use-inbox-copy";

export function InboxPage() {
  const { t } = useT("inbox");
  const copy = useInboxCopy();
  const wsId = useWorkspaceId();
  const openQuotaRecovery = useAutopilotQuotaRecovery();
  const paths = useWorkspacePaths();
  const { searchParams, replace } = useNavigation();
  const archived = searchParams.get("view") === "archived";
  const category = parseInboxCategory(searchParams.get("category"));
  const selectedKey = searchParams.get("item") ?? "";
  const manuallyUnread = useRef<string | null>(null);
  const active = useQuery({ ...inboxListOptions(wsId), enabled: !archived });
  const archive = useInfiniteQuery({ ...archivedInboxPagesOptions(wsId, EMPTY_INBOX_FILTERS), enabled: archived });
  const loadedItems = useMemo(() => (archived ? archive.data?.pages.flatMap(page => page.items) ?? [] : active.data ?? []).filter(isVisibleInboxItem), [archived, archive.data, active.data]);
  const visibleItems = useMemo(() => loadedItems.filter(item => category === "all" || inboxCategory(item) === category).toSorted((a, b) => {
    const weight = (severity: string) => severity === "action_required" ? 2 : severity === "attention" ? 1 : 0;
    return weight(b.severity) - weight(a.severity) || Date.parse(b.created_at) - Date.parse(a.created_at);
  }), [loadedItems, category]);
  const lookup = useQuery({ ...archivedInboxLookupOptions(wsId, selectedKey), enabled: archived && !!selectedKey && !loadedItems.some(item => item.id === selectedKey) });
  const selected = loadedItems.find(item => item.id === selectedKey) ?? lookup.data?.items.find(item => item.id === selectedKey && isVisibleInboxItem(item));
  const automationId = selected?.type === "autopilot_paused" ? autopilotNoticeId(selected) : null;
  const markRead = useMarkInboxRead();
  const markUnread = useMarkInboxUnread();
  const archiveItem = useArchiveInbox();
  const restoreItem = useUnarchiveInbox();
  const markAllRead = useMarkAllInboxRead();
  const pending = archived ? archive.isLoading : active.isLoading;
  const error = archived ? archive.error : active.error;
  const markReadMutate = markRead.mutate;

  const select = (id: string, nextArchived = archived, nextCategory: InboxCategory = category) => {
    const params = new URLSearchParams();
    if (nextArchived) params.set("view", "archived");
    if (nextCategory !== "all") params.set("category", nextCategory);
    if (id) params.set("item", id);
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
      <h1 className="text-body font-medium">{t($ => $.page.title)}</h1>
      <div className="ml-auto flex items-center gap-2">
        {!archived && <Button variant="ghost" size="icon-sm" aria-label={t($ => $.menu.mark_all_read)} onClick={() => markAllRead.mutate(undefined, { onError: mutationError })}><CheckCheck /></Button>}
        <Button variant="ghost" size="sm" onClick={() => select("", !archived)}>{archived ? t($ => $.page.back) : t($ => $.list.archived_title)}</Button>
      </div>
    </PageHeader>
    <nav aria-label={t($ => $.messages.category_label)} className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2">
      {(["all", "creations", "world", "system"] as const).map(value => <Button key={value} variant={category === value ? "brandSubtle" : "ghost"} size="sm" aria-pressed={category === value} onClick={() => select("", archived, value)}>{copy.categoryLabel(value)}</Button>)}
    </nav>
    <div className="flex min-h-0 flex-1">
      <div className={cn("w-full shrink-0 overflow-y-auto md:block md:w-80 md:border-r", selectedKey && "hidden")}>
        {pending && <p role="status" className="p-4 text-caption text-muted-foreground">{t($ => $.list.loading_selection)}</p>}
        {error && <div className="p-4"><p className="text-caption text-destructive">{error.message}</p><Button variant="outline" size="sm" onClick={retry}>{t($ => $.list.retry)}</Button></div>}
        {!pending && !error && visibleItems.length === 0 && <p className="p-4 text-caption text-muted-foreground">{category !== "all" ? t($ => $.messages.empty) : archived ? t($ => $.list.archived_empty) : t($ => $.list.empty)}</p>}
        {visibleItems.map(item => {
          const content = inboxContent(item);
          const group = inboxCategory(item);
          return <button type="button" key={item.id} onClick={() => { manuallyUnread.current = null; select(item.id); }} className={cn("flex w-full flex-col gap-2 p-4 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selectedKey === item.id && "bg-accent")} aria-current={selectedKey === item.id || undefined}>
            <span className="flex w-full items-center gap-2 text-caption text-muted-foreground">{group === "world" ? <Globe2 className="size-3.5" /> : group === "creations" ? <Sparkles className="size-3.5" /> : <Bell className="size-3.5" />}{copy.categoryLabel(group)}{!item.read && <span className="ml-auto size-1.5 rounded-full bg-brand" />}</span>
            <span className={cn("break-words text-body", !item.read && "font-semibold")}>{copy.title(item)}</span>
            {item.type === "world_digest" && content && <span className="line-clamp-2 text-caption text-muted-foreground">{copy.summary(content)}</span>}
            <time className="text-caption text-muted-foreground" dateTime={item.created_at}>{copy.time(item.created_at)}</time>
          </button>;
        })}
        {archived && archive.hasNextPage && <Button className="m-4" variant="outline" size="sm" disabled={archive.isFetchingNextPage} onClick={() => { void archive.fetchNextPage(); }}>{archive.isFetchingNextPage ? t($ => $.list.loading_more) : t($ => $.list.load_more)}</Button>}
      </div>
      <div className={cn("min-w-0 flex-1 overflow-y-auto", !selectedKey && "hidden md:block")}>
        {selectedKey && <Button className="m-2 md:hidden" variant="ghost" size="sm" onClick={() => select("")}><ArrowLeft />{t($ => $.page.back)}</Button>}
        {selected ? <article className={cn(PAGE_GUTTER, "mx-auto max-w-3xl py-6")}>
          <h2 className="break-words text-title-sm font-semibold">{copy.title(selected)}</h2>
          {selected.type === "autopilot_quota_exceeded" ? <AutopilotQuotaNotice item={selected} onOpenRecovery={openQuotaRecovery} /> : selected.type === "creation_ready" || selected.type === "character_milestone" || selected.type === "world_digest" ? <InboxMessageContent item={selected} /> : selected.body && <p className="mt-4 whitespace-pre-wrap text-body leading-relaxed">{selected.body}</p>}
          {selected.type === "autopilot_paused" && <AppLink href={automationId ? paths.autopilotDetail(automationId) : paths.autopilots()} className="mt-4 inline-flex rounded-sm text-label text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{t($ => $.messages.view_automation)}</AppLink>}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={archiveItem.isPending || restoreItem.isPending} onClick={() => {
              (archived ? restoreItem : archiveItem).mutate(selected.id, { onSuccess: () => select(""), onError: mutationError });
            }}>{archived ? <ArchiveRestore /> : <Archive />}{archived ? t($ => $.detail.unarchive) : t($ => $.detail.archive)}</Button>
            {!archived && <Button variant="ghost" size="sm" onClick={() => {
              if (selected.read) { manuallyUnread.current = selected.id; markUnread.mutate(selected.id, { onError: mutationError }); }
              else { manuallyUnread.current = null; markRead.mutate(selected.id, { onError: mutationError }); }
            }}>{selected.read ? t($ => $.context_menu.mark_unread) : t($ => $.context_menu.mark_read)}</Button>}
          </div>
        </article> : <p className="p-6 text-body text-muted-foreground">{lookup.isFetching ? t($ => $.list.loading_selection) : t($ => $.detail.select_prompt)}</p>}
      </div>
    </div>
  </div>;
}
