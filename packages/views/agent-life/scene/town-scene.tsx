"use client";
import { useEffect, useRef, useState } from "react";
import { Compass, Focus, Minus, Plus } from "lucide-react";
import type { LifeSnapshot } from "@auro/core/agent-life";
import { Button } from "@auro/ui/components/ui/button";
import { useT } from "../../i18n";
import { TownRuntime } from "./runtime";

export default function TownScene({ data, selectedId, onSelect, onProject }: { data: LifeSnapshot; selectedId?: string; onSelect: (id: string) => void; onProject: (id: string) => void }) {
  const { t } = useT("life");
  const host = useRef<HTMLDivElement>(null), label = useRef<HTMLDivElement>(null), runtime = useRef<TownRuntime | null>(null);
  const current = useRef({ data, selectedId, onSelect, onProject });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"), [retry, setRetry] = useState(0);
  useEffect(() => { current.current = { data, selectedId, onSelect, onProject }; runtime.current?.update(data, selectedId); }, [data, selectedId, onSelect, onProject]);
  useEffect(() => {
    if (!host.current) return;
    let disposed = false, scene: TownRuntime | undefined;
    setState("loading");
    try {
      scene = new TownRuntime(host.current, id => current.current.onSelect(id), id => current.current.onProject(id), (x, y, visible) => {
        if (!label.current) return;
        label.current.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
        label.current.style.visibility = visible ? "visible" : "hidden";
      });
      runtime.current = scene; scene.update(current.current.data, current.current.selectedId);
      void scene.start().then(() => { if (!disposed) setState("ready"); }).catch(() => { if (!disposed) { scene?.dispose(); runtime.current = null; setState("error"); } });
    } catch { setState("error"); }
    const observer = new ResizeObserver(() => scene?.resize()); observer.observe(host.current);
    return () => { disposed = true; observer.disconnect(); scene?.dispose(); runtime.current = null; };
  }, [retry]);
  const name = data.agents.find(agent => agent.id === selectedId)?.name;
  return <div className="town-scene" data-testid="town-map" data-scene-state={state}>
    <div className="town-scene-canvas" ref={host} role="img" aria-label={t($ => $.scene.label)} />
    {state !== "ready" && <div className="town-scene-status" role={state === "error" ? "alert" : "status"}><p>{t($ => state === "error" ? $.scene.error : $.scene.loading)}</p>{state === "error" && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>{t($ => $.retry)}</Button>}</div>}
    {state === "ready" && <>
      <div className="town-scene-name" ref={label}>{name}</div>
      <div className="town-scene-controls" aria-label={t($ => $.scene.controls)}>
        <Button size="icon-sm" variant="ghost" aria-label={t($ => $.scene.zoom_in)} onClick={() => runtime.current?.zoom(0.78)}><Plus /></Button>
        <Button size="icon-sm" variant="ghost" aria-label={t($ => $.scene.zoom_out)} onClick={() => runtime.current?.zoom(1.25)}><Minus /></Button>
        <Button size="icon-sm" variant="ghost" aria-label={t($ => $.scene.home)} onClick={() => runtime.current?.home()}><Compass /></Button>
        <Button size="icon-sm" variant="ghost" disabled={!selectedId} aria-label={t($ => $.scene.follow)} onClick={() => runtime.current?.followSelected()}><Focus /></Button>
      </div>
      <p className="town-scene-help">{t($ => $.scene.help)}</p>
    </>}
  </div>;
}
