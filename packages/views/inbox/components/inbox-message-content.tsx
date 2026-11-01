"use client";

import type { InboxItem } from "@auro/core/types";
import { inboxContent } from "@auro/core/inbox/messages";
import { useWorldGames } from "@auro/core/admin";
import { useWorkspaceId } from "@auro/core/hooks";
import { useWorkspacePaths } from "@auro/core/paths";
import { Button } from "@auro/ui/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";
import { useInboxCopy } from "./use-inbox-copy";

export function InboxMessageContent({ item }: { item: InboxItem }) {
  const { t } = useT("inbox");
  const copy = useInboxCopy();
  const paths = useWorkspacePaths();
  const games = useWorldGames(useWorkspaceId());
  const content = inboxContent(item);
  if (!content) return item.body ? <p className="mt-4 whitespace-pre-wrap text-body">{item.body}</p> : null;
  const available = (id: string) => games.data?.games.find(game => game.gameId === id)?.available === true;
  const hasOpenGame = content.entries.some(entry => available(entry.kind === "resident_goal_reached" ? "life" : "tanks"));
  const digest = item.type === "world_digest";
  return <div className="mt-5 space-y-5">
    {content.windowStart && content.windowEnd && <p className="text-caption text-muted-foreground">{t($ => $.messages.window, { start: copy.time(content.windowStart), end: copy.time(content.windowEnd) })}</p>}
    {digest && <p className="text-body font-medium leading-relaxed">{copy.summary(content)}</p>}
    <ul className="space-y-2">
      {content.entries.map(entry => <li key={entry.id} className="rounded-lg bg-muted/40 p-4">
        <p className="break-words text-body font-medium">{copy.entryText(entry)}</p>
        {digest && entry.authorName && <p className="mt-1 break-words text-caption text-muted-foreground">{t($ => $.messages.author, { name: entry.authorName })}</p>}
        <time dateTime={entry.occurredAt} className="mt-1 block text-caption text-muted-foreground">{copy.time(entry.occurredAt)}</time>
        {available(entry.kind === "resident_goal_reached" ? "life" : "tanks") && <AppLink href={entry.kind === "resident_goal_reached" ? `${paths.life()}?resident=${encodeURIComponent(entry.subjectId)}` : `${paths.tanks()}?character=${encodeURIComponent(entry.subjectId)}`} className="mt-3 inline-flex items-center gap-1 rounded-sm text-label text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{entry.kind === "resident_goal_reached" ? t($ => $.messages.view_resident) : t($ => $.messages.view_character)}<ArrowUpRight className="size-3.5" /></AppLink>}
      </li>)}
    </ul>
    {content.totalEntries > content.entries.length && <p className="text-caption text-muted-foreground">{t($ => $.messages.more, { count: content.totalEntries - content.entries.length })}</p>}
    {content.entries.some(entry => entry.kind === "tank_level_up") && <p className="text-caption text-muted-foreground">{t($ => $.messages.personal_records)}</p>}
    {games.isPending ? <p role="status" className="text-caption text-muted-foreground">{t($ => $.messages.checking)}</p> : games.isError ? <Button variant="outline" size="sm" onClick={() => void games.refetch()}>{t($ => $.messages.retry)}</Button> : !hasOpenGame ? <p role="status" className="text-caption text-muted-foreground">{t($ => $.messages.unavailable)}</p> : digest ? <AppLink href={content.entries.some(entry => entry.kind === "resident_goal_reached") && available("life") ? paths.life() : paths.tanks()} className="inline-flex items-center gap-1 rounded-sm text-label text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{content.entries.some(entry => entry.kind === "resident_goal_reached") && available("life") ? t($ => $.messages.view_world) : t($ => $.messages.browse_world)}<ArrowUpRight className="size-3.5" /></AppLink> : null}
  </div>;
}
