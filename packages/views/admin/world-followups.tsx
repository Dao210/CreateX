"use client";

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ClipboardList, Loader2, Plus } from "lucide-react";
import {
  useSaveWorldOpsFollowup, worldOpsAssigneesOptions, worldOpsEntriesOptions, worldOpsFollowupsOptions,
  type WorldOpsFollowup,
} from "@auro/core/admin";
import { ApiError } from "@auro/core/api";
import { Button } from "@auro/ui/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@auro/ui/components/ui/dialog";
import { useT } from "../i18n";

type Mode = "new" | "edit" | "close";

function FollowupForm({ userId, worldId, item, mode, onDone }: {
  userId: string;
  worldId: string;
  item?: WorldOpsFollowup;
  mode: Mode;
  onDone: () => void;
}) {
  const { t } = useT("admin");
  const options = useQuery({ ...worldOpsAssigneesOptions(userId), enabled: mode !== "close" });
  const [id] = useState(() => item?.id ?? crypto.randomUUID());
  const [assignee, setAssignee] = useState(item?.assignee_id ?? userId);
  const [date, setDate] = useState(item?.due_on ?? "");
  const [note, setNote] = useState("");
  const save = useSaveWorldOpsFollowup(userId, worldId);
  const hasAssignee = options.data?.some(candidate => candidate.id === assignee);
  const valid = mode === "close" ? Boolean(note.trim()) : Boolean(hasAssignee && (mode === "edit" || note.trim()));
  const conflict = save.error instanceof ApiError && save.error.status === 409;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || save.isPending || conflict) return;
    try {
      await save.mutateAsync({ id, input: {
        assigneeId: assignee, dueOn: date, note, expectedVersion: item?.version ?? 0, close: mode === "close",
      } });
      onDone();
    } catch {
      // Keep the operator's input available for retry.
    }
  }

  return <form className="world-followup-form" onSubmit={submit}>
    {mode !== "close" && <div className="world-followup-fields">
      <label>{t($ => $.worlds.assignee)}
        <select value={hasAssignee ? assignee : ""} onChange={event => setAssignee(event.target.value)} required disabled={save.isPending || !options.data}>
          {!hasAssignee && <option value="">{options.isPending ? t($ => $.loading) : t($ => $.worlds.choose_assignee)}</option>}
          {options.data?.map(candidate => <option key={candidate.id} value={candidate.id}>
            {candidate.id === userId ? t($ => $.worlds.me) : candidate.name}
          </option>)}
        </select>
      </label>
      <label>{t($ => $.worlds.due)}<input type="date" value={date} onChange={event => setDate(event.target.value)} disabled={save.isPending} /></label>
    </div>}
    <label>{mode === "new" ? t($ => $.worlds.reason) : mode === "close" ? t($ => $.worlds.result) : t($ => $.worlds.note)}
      <textarea rows={3} maxLength={1000} required={mode !== "edit"} value={note} onChange={event => setNote(event.target.value)} disabled={save.isPending} />
    </label>
    {mode !== "close" && options.isError && <div className="world-followup-error" role="alert">{t($ => $.load_error)} <Button type="button" variant="outline" size="sm" onClick={() => void options.refetch()}>{t($ => $.refresh)}</Button></div>}
    {save.isError && <div className="world-followup-error" role="alert">{conflict ? t($ => $.worlds.conflict) : t($ => $.worlds.save_error)}</div>}
    <DialogFooter>
      <DialogClose render={<Button type="button" variant="outline" disabled={save.isPending} />}>{t($ => $.worlds.cancel)}</DialogClose>
      <Button type="submit" disabled={!valid || save.isPending || conflict} aria-busy={save.isPending}>
        {save.isPending && <Loader2 className="animate-spin" />}
        {mode === "close" ? t($ => $.worlds.close) : t($ => $.worlds.save)}
      </Button>
    </DialogFooter>
  </form>;
}

function FollowupDialog({ userId, worldId, item, mode }: {
  userId: string;
  worldId: string;
  item?: WorldOpsFollowup;
  mode: Mode;
}) {
  const { t } = useT("admin");
  const [open, setOpen] = useState(false);
  const title = mode === "new" ? t($ => $.worlds.add) : mode === "close" ? t($ => $.worlds.close) : t($ => $.worlds.edit);
  const Icon = mode === "new" ? Plus : mode === "close" ? Check : null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button size="sm" variant={mode === "edit" ? "outline" : "default"} />}>
      {Icon && <Icon />}{title}
    </DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{t($ => $.worlds.private_followup)}</DialogDescription></DialogHeader>
      {open && <FollowupForm userId={userId} worldId={worldId} item={item} mode={mode} onDone={() => setOpen(false)} />}
    </DialogContent>
  </Dialog>;
}

function FollowupHistory({ userId, worldId, item }: { userId: string; worldId: string; item: WorldOpsFollowup }) {
  const { t, i18n } = useT("admin");
  const [page, setPage] = useState(0);
  const query = useQuery(worldOpsEntriesOptions(userId, worldId, item.id, page));
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" });
  const labels = { opened: t($ => $.worlds.opened), updated: t($ => $.worlds.updated), closed: t($ => $.worlds.closed) };
  if (!query.data) return <div className="world-ops-empty" role={query.isError ? "alert" : "status"}>
    {query.isError ? <>{t($ => $.load_error)} <Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t($ => $.refresh)}</Button></> : t($ => $.loading)}
  </div>;
  return <>
    <ol className="world-followup-history">
      {query.data.items.map(entry => <li key={entry.version}>
        <div><strong>{labels[entry.action]}</strong><span>{entry.actor || "—"} · <time dateTime={entry.created_at}>{date.format(new Date(entry.created_at))}</time></span></div>
        <p>{t($ => $.worlds.assignee)} {entry.assignee || "—"}{entry.due_on && <> · {t($ => $.worlds.due)} <time dateTime={entry.due_on}>{entry.due_on}</time></>}</p>
        {entry.note && <p className="world-followup-note">{entry.note}</p>}
      </li>)}
    </ol>
    {(page > 0 || query.data.more) && <div className="world-ops-pagination">
      <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>{t($ => $.worlds.previous)}</Button>
      <Button size="sm" variant="outline" disabled={!query.data.more} onClick={() => setPage(page + 1)}>{t($ => $.worlds.next)}</Button>
    </div>}
  </>;
}

export function WorldFollowups({ userId, worldId }: { userId: string; worldId: string }) {
  const { t } = useT("admin");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useQuery(worldOpsFollowupsOptions(userId, worldId, page));
  const active = query.data?.items.find(item => item.closed_at === null);
  return <section className="admin-panel world-followups" aria-labelledby="world-ops-followups-title">
    <div className="world-ops-panel-heading">
      <h3 id="world-ops-followups-title"><ClipboardList size={17} />{t($ => $.worlds.followup)}</h3>
      {!active && page === 0 && query.data && <FollowupDialog userId={userId} worldId={worldId} mode="new" />}
    </div>
    {!query.data ? <div className="world-ops-empty" role={query.isError ? "alert" : "status"}>{query.isError ? <>
      {t($ => $.load_error)} <Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t($ => $.refresh)}</Button>
    </> : t($ => $.loading)}</div> : query.data.items.length === 0 ? <p className="world-ops-empty">{t($ => $.worlds.no_followup)}</p>
      : <div className="world-followup-list">{query.data.items.map(item => <div key={item.id} className="world-followup-item">
        <div className="world-followup-summary">
          <div><span className="admin-tag">{item.closed_at ? t($ => $.worlds.closed) : t($ => $.worlds.pending)}</span><p>{item.reason}</p>
            <small>{item.assignee || "—"}{item.due_on && <> · {t($ => $.worlds.due)} <time dateTime={item.due_on}>{item.due_on}</time></>}</small></div>
          <div className="world-followup-actions">
            <Button size="sm" variant="ghost" aria-expanded={expanded === item.id}
              onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{t($ => $.worlds.history)}</Button>
            {!item.closed_at && <>
              <FollowupDialog userId={userId} worldId={worldId} item={item} mode="edit" />
              <FollowupDialog userId={userId} worldId={worldId} item={item} mode="close" />
            </>}
          </div>
        </div>
        {expanded === item.id && <FollowupHistory userId={userId} worldId={worldId} item={item} />}
      </div>)}</div>}
    {(page > 0 || query.data?.more) && <div className="world-ops-pagination">
      <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>{t($ => $.worlds.previous)}</Button>
      <Button size="sm" variant="outline" disabled={!query.data?.more} onClick={() => setPage(page + 1)}>{t($ => $.worlds.next)}</Button>
    </div>}
  </section>;
}
