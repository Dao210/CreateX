"use client";
import "./town.css";
import { useEffect, useState } from "react";
import type { StorageAdapter } from "@auro/core/types";
import { useAuthStore } from "@auro/core/auth";
import { useQuery } from "@tanstack/react-query";
import { Leaf } from "lucide-react";
import { type LifeSnapshot } from "@auro/core/agent-life";
import { lifeSnapshotOptions, lifeHistoryOptions } from "@auro/core/agent-life/queries";
import { useCurrentWorkspace } from "@auro/core/paths";
import { Button } from "@auro/ui/components/ui/button";
import { Progress } from "@auro/ui/components/ui/progress";
import { GameAccessBoundary } from "../admin/game-access-boundary";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { ActivityDialog, ResidentDialog, ResidentTalk } from "./town-forms";
import { TownMap } from "./town-map";

export function LifePage({ storage }: { storage: StorageAdapter }) {
  const userId = useAuthStore(s => s.user?.id);
  const workspace = useCurrentWorkspace();
  return workspace && userId ? <GameAccessBoundary gameId="life"><LifeContent key={`${workspace.id}:${userId}`} workspaceId={workspace.id} userId={userId} storage={storage} /></GameAccessBoundary> : null;
}
const clock = (tick: number) => `${String(Math.floor(tick % 1440 / 60)).padStart(2, "0")}:${String(tick % 60).padStart(2, "0")}`;
function LifeContent({ workspaceId, userId, storage }: { workspaceId: string; userId: string; storage: StorageAdapter }) {
  const cursorKey = `life:last-event:${workspaceId}:${userId}`;
  const [since] = useState<number | null>(() => { try { const raw = storage.getItem(cursorKey); if (raw === null) return null; const value = Number(raw); return Number.isSafeInteger(value) && value >= 0 ? value : null; } catch { return null; } });
  const { t } = useT("life"), navigation = useNavigation();
  const query = useQuery(lifeSnapshotOptions(workspaceId));
  const data = query.data, town = data?.town, world = data?.world;
  const cursor = data?.town && data.world ? data.eventCursor : null;
  const history = useQuery({ ...lifeHistoryOptions(workspaceId, userId, since ?? 0), enabled: cursor !== null && since !== null && since <= cursor });
  useEffect(() => { if (cursor !== null && document.visibilityState === "visible") { try { storage.setItem(cursorKey, String(cursor)); } catch { /* Viewing remains available without durable storage. */ } } }, [cursorKey, storage, cursor]);
  const selected = data?.agents.find(a => a.id === navigation.searchParams.get("resident")) ?? data?.agents[0];
  const choose = (id: string) => { const params = new URLSearchParams(navigation.searchParams); params.set("resident", id); navigation.replace(`${navigation.pathname}?${params}${navigation.hash}`); };
  const profile = town?.profiles.find(p => p.residentId === selected?.id);
  const plan = town?.plans.find(p => p.residentId === selected?.id && p.day === Math.floor((world?.tick ?? 0) / 1440));
  const minute = (world?.tick ?? 0) % 1440;
  const selectedAction = data?.actions.find(a => a.agentId === selected?.id);
  const currentSlot = plan?.slots.find(slot => slot.start <= minute && slot.end > minute);
  const memories = town?.memories.filter(m => m.residentId === selected?.id).sort((a, b) => b.tick - a.tick).slice(0, 12) ?? [];
  const conversations = town?.conversations.filter(c => c.residentId === selected?.id || c.otherId === selected?.id).slice(-8).reverse() ?? [];
  const relationships = town?.relationships.filter(r => r.residentId === selected?.id).sort((a, b) => b.familiarity - a.familiarity).slice(0, 6) ?? [];
  const residentName = (id: string | null) => data?.agents.find(a => a.id === id)?.name ?? t($ => $.visitor);
  const actions = t($ => $.actions, { returnObjects: true });
  const actionName = (kind: string | undefined) => kind && Object.hasOwn(actions, kind) ? actions[kind as keyof typeof actions] : t($ => $.idle);
  const dailyAction = selectedAction?.reason.startsWith("daily_") && currentSlot;
  const currentActionLabel = dailyAction && selectedAction?.intent.kind === "MOVE"
    ? t($ => $.going_to, { place: t($ => $.places[currentSlot.place]) })
    : dailyAction && selectedAction?.intent.kind === "REST" ? t($ => $.purposes[currentSlot.purpose]) : actionName(selectedAction?.intent.kind);
  const stale = world && query.dataUpdatedAt - Date.parse(world.updatedAt) > Math.max(15000, world.tickMs * 4);
  return <div className="town-page">
    <header className="town-page-header"><Leaf aria-hidden /><h1>{t($ => $.title)}</h1><div><ResidentDialog workspaceId={workspaceId} disabled={!town || (data?.agents.length ?? 0) >= 60} /></div></header>
    <main className="town-main">
      {query.isPending && <p role="status" className="town-state">{t($ => $.loading)}</p>}
      {query.isError && <div role="alert" className="town-state"><p>{t($ => $.error)}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t($ => $.retry)}</Button></div>}
      {data && !world && <p className="town-state">{t($ => $.empty)}</p>}
      {data && world && <>
        <header className="town-intro"><div><p data-testid="life-tick" className="town-overline">{t($ => $.tick, { tick: world.tick })}</p><h2>{t($ => $.day, { day: Math.floor(world.tick / 1440) + 1, time: clock(world.tick) })}</h2></div><div className="town-intro-status"><span role="status"><span className="town-live-dot" /> {stale ? t($ => $.paused) : t($ => $.live)}</span><span>{t($ => $.resident_count, { count: data.agents.length })}</span>{town && <span className="town-badge">{t($ => $.model_states[town.model.state])}</span>}</div></header>
        {history.data && history.data.total > 0 && <section className="town-panel"><h3 className="town-section-title">{t($ => $.while_away)}</h3><p className="town-note">{t($ => $.away_count, { count: history.data.total })}</p><ol className="town-event-list">{history.data.events.slice(0, 5).map(event => <li key={event.id}><time>{clock(event.tick)}</time>{eventText(event, data, actionName, t)}</li>)}</ol></section>}
        <div className="town-grid">
          <div className="town-map-column"><TownMap data={data} selectedId={selected?.id} onSelect={choose} /><div className="town-resident-list" aria-label={t($ => $.residents)}>{data.agents.map(agent => <Button key={agent.id} variant={agent.id === selected?.id ? "brand" : "ghost"} size="xs" aria-pressed={agent.id === selected?.id} onClick={() => choose(agent.id)}>{agent.name}</Button>)}</div>
            <section className="town-panel"><h3 className="town-section-title">{t($ => $.activities)}</h3>
              {!town?.activities.length && <p className="town-note">{t($ => $.activities_empty)}</p>}
              {town?.activities.slice(-6).reverse().map(activity => <article className="town-activity" key={activity.id}><strong>{activity.title}</strong><p>{residentName(activity.organizerId)} · {t($ => $.places[activity.place])} · {clock(activity.startTick)}–{clock(activity.endTick)}</p><p>{t($ => $.activity_states[activity.status])} · {t($ => $.attendee_count, { count: activity.attendees.length })}</p>{activity.decision && <p className="town-note">{activity.decision === "model_failed" ? t($ => $.command_error) : activity.decision === "shared_interest" ? t($ => $.shared_interest) : activity.decision === "different_interest" ? t($ => $.different_interest) : activity.decision}</p>}</article>)}
              {selected && town && <div><ActivityDialog workspaceId={workspaceId} data={data} residentId={selected.id} /></div>}
            </section>
          </div>
          {selected && <aside className="town-panel town-resident-sidebar" aria-label={selected.name}>
            <div className="town-profile"><h3>{selected.name}</h3><p>{profile && t($ => $.occupations[profile.occupation])} · {currentActionLabel}</p>{profile?.background && <p>{profile.background}</p>}<div className="town-tags">{profile?.interests.map(interest => <span className="town-badge" key={interest}>{t($ => $.interests[interest])}</span>)}{plan && <span className="town-badge">{plan.source === "model" ? t($ => $.model_plan) : t($ => $.routine_plan)}</span>}</div></div>
            <div className="town-needs">{(["energy", "fullness", "social"] as const).map(need => <div key={need}><span>{t($ => $[need])} {selected[need]}</span><Progress value={selected[need]} aria-label={t($ => $[need])} /></div>)}</div>
            <section><h4 className="town-section-title">{t($ => $.today_plan)}</h4><ol className="town-agenda">{plan?.slots.filter(slot => slot.end > minute).slice(0, 5).map(slot => <li key={slot.start} className={slot.start <= minute && slot.end > minute ? "town-current" : ""}><time>{clock(slot.start)}</time><span>{t($ => $.purposes[slot.purpose])} · {t($ => $.places[slot.place])}{slot.reason && <p className="town-note">{slot.reason}</p>}</span></li>)}</ol></section>
            <section><h4 className="town-section-title">{t($ => $.relationships)}</h4>{!relationships.length && <p className="town-note">{t($ => $.relationships_empty)}</p>}{relationships.map(row => <div key={row.otherId} className="town-relation"><Button variant="link" size="xs" onClick={() => choose(row.otherId)}>{residentName(row.otherId)}</Button><span>{t($ => $.familiarity, { count: row.familiarity })}</span></div>)}</section>
            <ResidentTalk key={selected.id} workspaceId={workspaceId} data={data} residentId={selected.id} />
          </aside>}
        </div>
        <div className="town-stories">
          <section className="town-panel"><h3 className="town-section-title">{t($ => $.memories)}</h3>{!memories.length && <p className="town-note">{t($ => $.memories_empty)}</p>}<ol className="town-memory-list">{memories.map(memory => <li key={memory.id}><time>{t($ => $.day, { day: Math.floor(memory.tick / 1440) + 1, time: clock(memory.tick) })} · {t($ => $.memory_kinds[memory.kind])}</time>{memory.text || t($ => $.meeting_memory, { name: residentName(memory.otherId) })}{memory.evidence.length > 0 && <p className="town-note">{t($ => $.memory_evidence, { count: memory.evidence.length })}</p>}</li>)}</ol></section>
          <section className="town-panel"><h3 className="town-section-title">{t($ => $.conversations)}</h3>{!conversations.length && <p className="town-note">{t($ => $.conversations_empty)}</p>}<div className="town-conversation-list">{conversations.map(conversation => <article key={conversation.id} className="town-conversation"><small>{clock(conversation.tick)} · {conversation.source === "rules" ? t($ => $.rule_conversation) : conversation.source === "model" ? t($ => $.model_conversation) : t($ => $.visitor)}</small>{conversation.source === "rules" ? <p>{conversation.activityIds.length ? t($ => $.invitation_record, { name: residentName(conversation.residentId), other: residentName(conversation.otherId), title: conversation.lines[0]?.text }) : t($ => $.meeting_record, { name: residentName(conversation.residentId), other: residentName(conversation.otherId) })}</p> : conversation.lines.map((line, i) => <p key={i}><strong>{residentName(line.speakerId)}</strong> {line.text}</p>)}</article>)}</div></section>
        </div>
        <section className="town-panel"><h3 className="town-section-title">{t($ => $.events)}</h3><ol className="town-event-list">{data.events.filter(e => e.kind !== "resources_replenished").slice(0, 12).map(event => <li key={event.id}><time>{clock(event.tick)}</time>{eventText(event, data, actionName, t)}</li>)}</ol></section>
      </>}
    </main>
  </div>;
}
function eventText(event: LifeSnapshot["events"][number], data: LifeSnapshot, actionName: (kind: string | undefined) => string, t: ReturnType<typeof useT<"life">>["t"]) {
  if (event.kind === "world_created") return t($ => $.created, { count: data.agents.length });
  if (event.kind === "town_conversation") return t($ => $.conversation_event);
  if (event.kind === "town_activity") return t($ => $.activity_event, { title: typeof event.payload.title === "string" ? event.payload.title : "" });
  if (event.kind === "town_command") return t($ => $.town_changed);
  const intent = event.payload.intent;
  const kind = intent && typeof intent === "object" && "kind" in intent && typeof intent.kind === "string" ? intent.kind : undefined;
  const name = data.agents.find(a => a.id === event.agentId)?.name ?? t($ => $.visitor);
  return t($ => event.kind === "action_failed" ? $.failed : $.completed, { name, action: actionName(kind) });
}
