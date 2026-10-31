"use client";

import { useQuery } from "@tanstack/react-query";
import { House, Sprout, Trees, Users, Leaf } from "lucide-react";
import { LIFE_MAP, type LifeSnapshot } from "@auro/core/agent-life";
import { lifeSnapshotOptions } from "@auro/core/agent-life/queries";
import { useCurrentWorkspace } from "@auro/core/paths";
import { Button } from "@auro/ui/components/ui/button";
import { Progress } from "@auro/ui/components/ui/progress";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { PageHeader } from "../layout/page-header";

export function LifePage() {
  const workspace = useCurrentWorkspace();
  return workspace ? <LifeContent key={workspace.id} workspaceId={workspace.id} /> : null;
}

function LifeContent({ workspaceId }: { workspaceId: string }) {
  const { t } = useT("life");
  const query = useQuery(lifeSnapshotOptions(workspaceId));
  const navigation = useNavigation();
  const data = query.data;
  const selectedId = navigation.searchParams.get("resident");
  const selected = data?.agents.find((a) => a.id === selectedId) ?? data?.agents[0];
  const choose = (id: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    params.set("resident", id);
    navigation.replace(`${navigation.pathname}?${params}${navigation.hash}`);
  };
  const actions = t(($) => $.actions, { returnObjects: true });
  const actionName = (kind: string | undefined) => kind && Object.hasOwn(actions, kind) ? actions[kind as keyof typeof actions] : kind ? t(($) => $.unknown) : t(($) => $.idle);
  const world = data?.world;
  const stale = world && query.dataUpdatedAt - Date.parse(world.updatedAt) > Math.max(15_000, world.tickMs * 4);
  const amount = (owner: string, kind: string) => data?.resources.find((r) => r.owner === owner && r.kind === kind)?.amount ?? 0;
  return <>
    <PageHeader><Leaf className="size-4 text-success" aria-hidden /><h1 className="flex-1 text-body font-medium">{t(($) => $.title)}</h1></PageHeader>
    <main className="mx-auto min-h-0 w-full max-w-[1400px] flex-1 space-y-5 overflow-y-auto p-4 pb-12 lg:p-6">
      {query.isPending && <p role="status" className="text-body text-muted-foreground">{t(($) => $.loading)}</p>}
      {query.isError && <div role="alert" className="flex items-center gap-3 text-body text-destructive"><span>{t(($) => $.error)}</span><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t(($) => $.retry)}</Button></div>}
      {data && !world && <p className="text-body text-muted-foreground">{t(($) => $.empty)}</p>}
      {data && world && <>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div><p data-testid="life-tick" className="font-mono text-caption uppercase tracking-widest text-muted-foreground">{t(($) => $.tick, { tick: world.tick })}</p><h2 className="mt-1 font-serif text-title-lg">{t(($) => $.day, { day: Math.floor(world.tick / 1440) + 1, time: `${String(Math.floor(world.tick % 1440 / 60)).padStart(2, "0")}:${String(world.tick % 60).padStart(2, "0")}` })}</h2></div>
          <p role="status" className={`flex items-center gap-2 text-caption ${stale ? "text-warning" : "text-success"}`}><span className="size-2 rounded-full bg-current" aria-hidden />{stale ? t(($) => $.paused) : t(($) => $.live)}</p>
        </header>
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section aria-label={t(($) => $.map)} className="min-w-0 overflow-x-auto rounded-xl border border-border bg-card p-3">
            <div className="relative grid min-w-[560px] grid-cols-12 overflow-hidden rounded-lg bg-success/5" style={{ gridTemplateRows: "repeat(8, 56px)" }}>
              {Array.from({ length: 96 }, (_, i) => {
                const x = i % 12, y = Math.floor(i / 12);
                const landmark = ([["home", House], ["farm", Sprout], ["forest", Trees], ["square", Users]] as const).find(([key]) => LIFE_MAP[key].x === x && LIFE_MAP[key].y === y);
                const Icon = landmark?.[1];
                return <div key={i} className={`relative flex min-h-0 flex-col border-b border-r border-border/30 p-1 ${landmark ? "bg-success/10" : ""}`}>
                  {landmark && Icon && <div className="flex shrink-0 items-center gap-1 overflow-hidden text-success"><Icon className="size-3 shrink-0" aria-hidden /><span className="truncate text-micro">{t(($) => $.places[landmark[0]])}</span></div>}
                  <div className="flex min-h-0 flex-1 flex-wrap content-start gap-0.5 overflow-y-auto">{data.agents.filter((agent) => agent.position.x === x && agent.position.y === y).map((agent) => <Button key={agent.id} variant={selected?.id === agent.id ? "brand" : "outline"} size="icon-xs" className="shrink-0 rounded-full font-mono shadow-sm" aria-label={t(($) => $.position, { name: agent.name, x, y })} aria-pressed={selected?.id === agent.id} title={`${agent.name} · ${actionName(data.actions.find((a) => a.agentId === agent.id)?.intent.kind)}`} onClick={() => choose(agent.id)}>{data.agents.findIndex((a) => a.id === agent.id) + 1}</Button>)}</div>
                </div>;
              })}
            </div>
          </section>
          <aside className="min-w-0 space-y-4">
            {selected && <section className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label={selected.name}>
              <div><p className="text-caption text-muted-foreground">{t(($) => $.residents)} · {data.agents.length}</p><h3 className="mt-1 font-serif text-title-lg">{selected.name}</h3><p className="mt-1 text-body text-brand">{actionName(data.actions.find((a) => a.agentId === selected.id)?.intent.kind)}</p></div>
              {(["energy", "fullness", "social"] as const).map((need) => <div key={need}><div className="mb-1 flex justify-between text-caption"><span>{t(($) => $[need])}</span><span className="font-mono">{selected[need]}</span></div><Progress value={selected[need]} aria-label={t(($) => $[need])} /></div>)}
              <p className="text-caption text-muted-foreground">{t(($) => $.inventory, { food: amount(selected.id, "food"), wood: amount(selected.id, "wood"), coins: amount(selected.id, "coins") })}</p>
              <p className="text-caption">{t(($) => $.goals, { resource: selected.goal.kind === "wood" ? t(($) => $.wood) : t(($) => $.coins), amount: amount(selected.id, selected.goal.kind), target: selected.goal.target })}</p>
            </section>}
            <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto" aria-label={t(($) => $.residents)}>{data.agents.map((agent) => <Button key={agent.id} variant={selected?.id === agent.id ? "brand" : "ghost"} size="xs" aria-pressed={selected?.id === agent.id} onClick={() => choose(agent.id)}>{agent.name}</Button>)}</div>
          </aside>
        </div>
        <section aria-labelledby="life-events-title" className="rounded-xl border border-border bg-card p-4">
          <h2 id="life-events-title" className="mb-3 text-title-sm font-medium">{t(($) => $.events)}</h2>
          <ol className="max-h-48 space-y-2 overflow-y-auto" aria-live="off">{data.events.map((event) => <li key={event.id} className="flex items-start gap-4 text-caption"><span className="w-16 shrink-0 font-mono text-muted-foreground">{t(($) => $.tick, { tick: event.tick })}</span><span className={event.kind === "action_failed" ? "text-warning" : "text-foreground"}>{eventText(event, data, actionName, t)}</span></li>)}</ol>
        </section>
      </>}
    </main>
  </>;
}

function eventText(event: LifeSnapshot["events"][number], data: LifeSnapshot, actionName: (kind: string | undefined) => string, t: ReturnType<typeof useT<"life">>["t"]) {
  if (event.kind === "resources_replenished") return t(($) => $.replenished);
  if (event.kind === "world_created") return t(($) => $.created, { count: Number(event.payload.residents) || data.agents.length });
  const intent = event.payload.intent;
  const kind = intent && typeof intent === "object" && "kind" in intent && typeof intent.kind === "string" ? intent.kind : undefined;
  const name = data.agents.find((a) => a.id === event.agentId)?.name ?? t(($) => $.unknown);
  return t(($) => event.kind === "action_failed" ? $.failed : $.completed, { name, action: actionName(kind) });
}
