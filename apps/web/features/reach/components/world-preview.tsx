"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronDown, Compass, Focus, Sparkles } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@auro/ui/components/ui/button";
import { chronicleLine, WORLD_WIDTH, type Chronicle, type EntityView, type SeasonInfo, type WorldSnapshot } from "../types";
import { useWorld, type WorldSource } from "../use-world";
import { chronicleLanguage, eventLocation, resolveSelection, type WorldSelection } from "../world-presentation";
import type { WorldDict } from "@/features/landing/i18n/types";
import { CreationPortrait } from "./creation-portrait";
import styles from "./world-preview.module.css";

const WorldWindow = dynamic(() => import("./world-window").then((module) => module.WorldWindow), { ssr: false });
type Copy = Pick<WorldDict, "clock" | "feed" | "map" | "explorer">;
type Props = { locale: string; copy: Copy; children: ReactNode };

export function WorldPreview(props: Props) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><WorldPreviewContent {...props} /></QueryClientProvider>;
}

function WorldPreviewContent(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const world = useWorld(visible);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [world.snapshot.season]);
  return <WorldExplorer key={world.snapshot.season} {...props} {...world} visible={visible} mapRef={container} />;
}

function WorldExplorer({ locale, copy, children, snapshot, season, source, reducedMotion, active, visible, mapRef }: Props & {
  snapshot: WorldSnapshot; season: SeasonInfo | null; source: WorldSource; reducedMotion: boolean; active: boolean; visible: boolean;
  mapRef: RefObject<HTMLDivElement | null>;
}) {
  const id = useId();
  const [selection, setSelection] = useState<WorldSelection | null>(null);
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const selectEntity = useCallback((entityId: string) => setSelection({ kind: "entity", id: entityId }), []);
  const { entity, event, focus } = resolveSelection(snapshot, selection);
  const demo = source === "preview" || source === "connecting";
  const stateLabel = source === "live" ? copy.clock.live : source === "paused" ? copy.clock.paused : copy.clock.preview;
  const nameOf = (item: EntityView) => demo ? copy.explorer.names[item.id] ?? item.name : item.name;
  const latest = event ?? [...snapshot.chronicle].reverse().find((item) => entity && item.entities?.includes(entity.id));
  const events = snapshot.chronicle.slice(-3).reverse();
  const alive = snapshot.entities.filter((item) => item.status === "alive");
  const samples = alive.slice(0, 3);
  const weapon = alive.find((item) => item.kind === "weapon" && !samples.some((sample) => sample.id === item.id));
  if (weapon) samples.push(weapon);
  else if (alive[3]) samples.push(alive[3]);
  const numbers = new Intl.NumberFormat(locale);
  const belt = entity ? Math.max(0, Math.min(2, Math.floor(entity.x / (WORLD_WIDTH / 3)))) : event?.belt;
  const beltName = belt !== undefined ? copy.explorer.belts[belt] : undefined;
  const nextEntity = () => {
    const index = alive.findIndex((item) => item.id === entity?.id);
    const next = alive[(index + 1) % alive.length];
    if (next) selectEntity(next.id);
  };
  const eventCard = (item: Chronicle) => {
    const locatable = Boolean(eventLocation(snapshot, item));
    return <button key={item.seq} type="button" className={styles.event} disabled={!ready || !locatable} aria-pressed={event?.seq === item.seq} onClick={() => setSelection({ kind: "event", seq: item.seq })}>
      <span className={styles.eventMeta}><span>{copy.clock.label} {numbers.format(item.beat)}</span>{locatable && <ArrowUpRight size={15} aria-hidden="true" />}</span>
      <span lang={chronicleLanguage(item, locale)} className={styles.eventText}>{chronicleLine(item.text, locale)}</span>
    </button>;
  };

  return (
    <section className={styles.explorer} aria-labelledby={`${id}-title`} data-testid="world-explorer" data-world-source={source} data-selected-entity={entity?.id} data-selected-event={event?.seq}>
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}><span aria-hidden="true">✳</span> {copy.map.title}</p><h2 id={`${id}-title`} className={`landing-serif ${styles.title}`}>{copy.explorer.title}</h2></div>
        <div className={styles.clock}><span className={styles.status} data-live={source === "live"}><i aria-hidden="true" />{stateLabel}</span><span>{copy.clock.label} <strong>{numbers.format(snapshot.beat)}</strong></span></div>
      </div>

      <div className={styles.world}>
        <div className={styles.stage}>
          <div ref={mapRef} className={styles.mapFrame} data-testid="world-map" data-view={selection?.kind === "overview" ? "overview" : "following"}>
            <div className={styles.poster} hidden={ready}>{children}</div>
            {(visible || ready) && <div className={styles.canvasLayer}><WorldWindow snapshot={snapshot} selectedId={entity?.id} selectedName={entity ? nameOf(entity) : undefined} focus={focus} onSelect={selectEntity} beatSeconds={season?.beatSeconds ?? 60} reducedMotion={reducedMotion || source !== "live"} active={active} label={copy.map.label} onReady={onReady} /></div>}
            <div className={styles.mapToolbar}><span className={styles.mapLocation}><Compass size={16} aria-hidden="true" />{selection?.kind === "overview" ? copy.explorer.overview : beltName ?? copy.map.title}</span><Button variant="ghost" size="sm" disabled={!ready} aria-pressed={selection?.kind === "overview"} onClick={() => setSelection({ kind: "overview" })}><Focus aria-hidden="true" />{copy.explorer.overview}</Button></div>
            <div className={styles.mapBottom}><span>{ready ? stateLabel : copy.clock.preview} · {ready && !demo ? snapshot.season : copy.map.previewData}</span><span className={styles.north} aria-hidden="true">↑ N</span></div>
          </div>

          <aside className={styles.story} aria-label={copy.explorer.following}>
            <div className={styles.storyHero}>
              {entity ? <div className={styles.portrait}><CreationPortrait entity={entity} /></div> : <div className={styles.portrait}><Compass size={56} strokeWidth={1} aria-hidden="true" /></div>}
              <div aria-live="polite" aria-atomic="true">
                <p className={styles.eyebrow}>{event ? copy.explorer.eventFocus : copy.explorer.following}</p>
                <h3 className={styles.entityName} data-testid="world-character-name">{entity ? nameOf(entity) : beltName ?? copy.map.title}</h3>
                {entity && <p className={styles.entityKind}>{entity.kind === "weapon" ? copy.explorer.weapon : copy.explorer.character}<span aria-hidden="true"> · </span><span data-alive={entity.status === "alive"}>{entity.status === "alive" ? copy.explorer.alive : copy.explorer.fallen}</span></p>}
              </div>
            </div>
            <div className={styles.storyText} aria-live="polite" aria-atomic="true">
              <span className={styles.quote} aria-hidden="true">“</span>
              {latest ? <p lang={chronicleLanguage(latest, locale)}>{chronicleLine(latest.text, locale)}</p> : <p>{entity ? copy.explorer.unwritten : copy.explorer.empty}</p>}
            </div>
            {entity && <dl className={styles.facts}><div><dt>{copy.explorer.survived}</dt><dd>{numbers.format(entity.survived)} <span>{copy.explorer.beats}</span></dd></div><div><dt>{copy.explorer.health}</dt><dd>{Math.round(Math.max(0, Math.min(100, entity.hp)))}<span>%</span></dd></div></dl>}
            <Button className={styles.next} variant="ghost" size="sm" disabled={alive.length < 2 || !ready} onClick={nextEntity}>{copy.explorer.meetNext}<ArrowRight aria-hidden="true" /></Button>
          </aside>
        </div>

        <div className={styles.belowMap}><p className={styles.hint}>{copy.explorer.selectHint}</p><div className={styles.legend}><span><i className={styles.supplyDot} />{copy.explorer.supply}</span><span><i className={styles.riftLine} />{copy.explorer.rift}</span><span><i className={styles.wreckMark} />{copy.explorer.remains}</span></div></div>
        {samples.length > 0 && <div className={styles.samples} role="group" aria-label={copy.explorer.choose}>{samples.map((sample) => <button key={sample.id} type="button" className={styles.sample} disabled={!ready} aria-pressed={entity?.id === sample.id && !event} onClick={() => selectEntity(sample.id)}><CreationPortrait entity={sample} /><span><strong>{nameOf(sample)}</strong><small>{sample.kind === "weapon" ? copy.explorer.weapon : copy.explorer.character}</small></span><ArrowUpRight size={15} aria-hidden="true" /></button>)}</div>}
      </div>

      <div className={styles.chronicle}>
        <div className={styles.chronicleHeading}><h3><span className={styles.chronicleMark} aria-hidden="true" />{copy.feed.title}</h3>{events.length > 1 && <Button className={styles.moreButton} variant="ghost" size="sm" aria-expanded={expanded} aria-controls={`${id}-events`} onClick={() => setExpanded(!expanded)}>{expanded ? copy.explorer.less : copy.explorer.more}<ChevronDown aria-hidden="true" /></Button>}</div>
        {events.length ? <div className={styles.eventGrid}>{events[0] && eventCard(events[0])}<div id={`${id}-events`} className={styles.extraEvents} data-expanded={expanded}>{events.slice(1).map(eventCard)}</div></div> : <p className={styles.hint}>{copy.feed.empty}</p>}
      </div>
      <div className={styles.invitation}><p><Sparkles size={18} strokeWidth={1.5} aria-hidden="true" />{copy.explorer.nextStory}</p><Link href="#create" className={styles.createLink}>{copy.explorer.create}<ArrowRight size={16} aria-hidden="true" /></Link></div>
    </section>
  );
}
