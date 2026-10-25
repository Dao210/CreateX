"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LandingFooter } from "@/features/landing/components/landing-footer";
import { LandingHeader } from "@/features/landing/components/landing-header";
import { heroButtonClassName } from "@/features/landing/components/shared";
import { useLocale } from "@/features/landing/i18n";
import { chronicleLine, type Chronicle } from "../types";
import { useWorld, type WorldSource } from "../use-world";
import { WorldWindow } from "./world-window";

const ACCENT = "#C8622D";

export function ReachLanding() {
  const { t, locale } = useLocale();
  const copy = t.world;
  const { snapshot, season, source, reducedMotion } = useWorld();
  const live = source === "live";
  const beatSeconds = season?.beatSeconds ?? 60;
  // The snapshot crosses a network boundary, so treat the arrays as optional
  // even though the type says otherwise.
  const entities = snapshot.entities ?? [];
  const wrecks = snapshot.wrecks ?? [];
  const chronicle = snapshot.chronicle ?? [];
  const alive = entities.filter((e) => e.status === "alive").length;

  return (
    <div className="min-h-full bg-[#0A0B0E] text-[#E8E1D5] selection:bg-[#C8622D]/30">
      <section id="world" className="relative">
        <LandingHeader variant="dark" />

        <div className="mx-auto max-w-[1320px] px-4 pb-10 pt-[76px] sm:px-6 lg:px-8 lg:pb-8">
          {/* Console strip: identity on the left, the world's pulse on the right. */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/8 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/45">
              <span className="text-white/80">REACH</span>
              <span className="mx-2 text-white/20">—</span>
              {copy.eyebrow}
              <span className="mx-2 text-white/20">/</span>
              <span className={live ? "text-white/70" : "text-white/40"}>
                {live ? snapshot.season : copy.clock.preview}
              </span>
            </p>
            <WorldClock
              source={source}
              beat={snapshot.beat}
              alive={alive}
              wrecks={wrecks.length}
              copy={copy.clock}
            />
          </div>

          {/* The claim sits above the world, so a visitor reads what this is
              before deciding whether the map is worth their attention. */}
          <div className="pt-7 sm:pt-9 lg:pt-11">
            <h1 className="max-w-[22ch] text-[2.3rem] font-semibold leading-[1.03] tracking-[-0.035em] text-[#E8E1D5] sm:text-[3rem] lg:text-[3.5rem]">
              {copy.claim}
            </h1>
            <p className="mt-4 max-w-[600px] text-balance text-[15.5px] leading-[1.65] text-white/58 sm:text-[16px]">
              {copy.sub}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-3">
              <Link href="#create" className={heroButtonClassName("solid")}>
                {copy.primaryCta}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link href="#world" className={heroButtonClassName("ghost")}>
                {copy.secondaryCta}
              </Link>
              <span className="text-[13px] text-white/48">{copy.note}</span>
            </div>
          </div>

          {/* 2:1 frame. The world grid is 2048 × 1024, so a frame near that ratio
              shows the whole map instead of cropping it into a thin band. */}
          <div className="mt-8 grid gap-4 sm:mt-9 lg:mt-10 lg:h-[clamp(320px,calc(100vh_-_440px),520px)] lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="relative h-[clamp(230px,34vh,300px)] overflow-hidden border border-white/10 bg-[#08090B] sm:h-[clamp(280px,40vh,380px)] lg:h-full">
              <WorldWindow
                snapshot={snapshot}
                beatSeconds={beatSeconds}
                reducedMotion={reducedMotion}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#08090B] via-[#08090B]/70 to-transparent" />
              <div className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                <span className={live ? "text-white/60" : undefined}>
                  {live ? copy.clock.live : source === "paused" ? copy.clock.paused : copy.clock.preview}
                </span>
                <span className="text-white/25">·</span>
                <span>
                  {live
                    ? `${snapshot.rulesVersion} · ${snapshot.digest.slice(0, 8)} · ${beatSeconds}s/beat`
                    : `${snapshot.rulesVersion} · demo data`}
                </span>
              </div>
              <span className="pointer-events-none absolute left-0 top-0 size-3 border-l border-t border-white/20" />
              <span className="pointer-events-none absolute right-0 top-0 size-3 border-r border-t border-white/20" />
              <span className="pointer-events-none absolute bottom-0 left-0 size-3 border-b border-l border-white/20" />
              <span className="pointer-events-none absolute bottom-0 right-0 size-3 border-b border-r border-white/20" />
            </div>

            <ChroniclePanel
              title={copy.feed.title}
              empty={copy.feed.empty}
              events={chronicle.slice(-11).reverse()}
              locale={locale}
              live={live}
              footer={`${snapshot.rulesVersion} · ${live ? snapshot.digest.slice(0, 8) : "preview"}`}
            />
          </div>
        </div>
      </section>

      <RulesSection
        title={copy.rules.title}
        lead={copy.rules.lead}
        items={copy.rules.items}
      />

      <CreateSection
        title={copy.create.title}
        lead={copy.create.lead}
        weapon={copy.create.weapon}
        character={copy.create.character}
        cta={copy.create.cta}
      />

      <ConnectSection
        title={copy.connect.title}
        lead={copy.connect.lead}
        command={copy.connect.command}
        steps={copy.connect.steps}
        agents={copy.connect.agents}
      />

      <Closing line={copy.closing.line} cta={copy.closing.cta} />

      <LandingFooter tagline={copy.closing.footerNote} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function WorldClock({
  source,
  beat,
  alive,
  wrecks,
  copy,
}: {
  source: WorldSource;
  beat: number;
  alive: number;
  wrecks: number;
  copy: {
    label: string;
    season: string;
    alive: string;
    wrecks: string;
    live: string;
    preview: string;
    paused: string;
  };
}) {
  const tone =
    source === "live" ? ACCENT : source === "paused" ? "#8C7A5B" : "rgba(232,225,213,0.3)";
  const label =
    source === "live" ? copy.live : source === "paused" ? copy.paused : copy.preview;
  const value = "text-[13px] tracking-normal text-white/75 tabular-nums";

  return (
    <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40 sm:gap-5">
      <span className="flex items-center gap-2">
        <span
          className="inline-block size-1.5 rounded-full"
          style={{
            backgroundColor: tone,
            boxShadow: source === "live" ? `0 0 8px ${ACCENT}` : undefined,
          }}
        />
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        {copy.label}
        <span className={value}>{beat}</span>
      </span>
      <span className="hidden items-baseline gap-1.5 sm:flex">
        {copy.alive}
        <span className={value}>{alive}</span>
      </span>
      <span className="hidden items-baseline gap-1.5 md:flex">
        {copy.wrecks}
        <span className={value}>{wrecks}</span>
      </span>
    </div>
  );
}

function ChroniclePanel({
  title,
  empty,
  events,
  locale,
  live,
  footer,
}: {
  title: string;
  empty: string;
  events: Chronicle[];
  locale: string;
  live: boolean;
  footer: string;
}) {
  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden border border-white/10 bg-[#0C0E11] lg:flex lg:h-full">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
          {title}
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.14em]"
          style={{ color: live ? ACCENT : "rgba(232,225,213,0.28)" }}
        >
          {live ? "live" : "demo"}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {events.length === 0 ? (
          <p className="px-4 py-3 text-[12px] leading-relaxed text-white/40">{empty}</p>
        ) : (
          <ol className="space-y-3 px-4 py-3">
            {events.map((event) => (
              <li key={event.seq} className="flex gap-2.5">
                <span className="mt-[3px] w-7 shrink-0 font-mono text-[10px] tabular-nums text-white/25">
                  {event.beat}
                </span>
                <span
                  className="text-[12.5px] leading-[1.5]"
                  style={{
                    color: event.kind === "catastrophe" ? ACCENT : "rgba(232,225,213,0.74)",
                  }}
                >
                  {chronicleLine(event.text, locale)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {/* The feed is deliberately clipped rather than scrolled: it is a window
            on the last few events, not an archive. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#0C0E11] via-[#0C0E11]/90 to-transparent" />
      </div>

      <div className="flex items-center justify-between border-t border-white/8 px-4 py-2 font-mono text-[10px] tracking-[0.08em] text-white/30">
        <span>{footer}</span>
        <span>{events[0]?.beat ?? "—"}</span>
      </div>
    </aside>
  );
}

function SectionHead({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="max-w-[720px]">
      <h2 className="text-[1.55rem] font-semibold leading-[1.2] tracking-[-0.025em] text-[#E8E1D5] sm:text-[1.9rem]">
        {title}
      </h2>
      {lead && <p className="mt-3 text-[15px] leading-[1.7] text-white/55">{lead}</p>}
    </div>
  );
}

function RulesSection({
  title,
  lead,
  items,
}: {
  title: string;
  lead: string;
  items: { k: string; f: string; t: string; d: string }[];
}) {
  return (
    <section className="border-t border-white/8">
      <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <SectionHead title={title} lead={lead} />
        <div className="mt-12 grid gap-px bg-white/8 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.k} className="bg-[#0A0B0E] p-6 sm:p-7">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                  {item.k}
                </span>
                <span className="font-mono text-[22px] tabular-nums" style={{ color: ACCENT }}>
                  {item.f}
                </span>
              </div>
              <h3 className="mt-6 text-[16px] font-semibold text-[#E8E1D5]">{item.t}</h3>
              <p className="mt-2 text-[13.5px] leading-[1.65] text-white/52">{item.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CreateSection({
  title,
  lead,
  weapon,
  character,
  cta,
}: {
  title: string;
  lead: string;
  weapon: { label: string; name: string; lines: string[] };
  character: { label: string; name: string; lines: string[] };
  cta: string;
}) {
  return (
    <section id="create" className="border-t border-white/8">
      <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <SectionHead title={title} lead={lead} />
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <SpecCard label={weapon.label} name={weapon.name} lines={weapon.lines} />
          <SpecCard label={character.label} name={character.name} lines={character.lines} />
        </div>
        <div className="mt-8">
          <Link href="#connect" className={heroButtonClassName("ghost")}>
            {cta}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

function SpecCard({ label, name, lines }: { label: string; name: string; lines: string[] }) {
  return (
    <div className="border border-white/10 bg-[#0C0E11] p-6 sm:p-7">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/38">
          {label}
        </span>
        <span className="font-mono text-[10px] text-white/32">reach.entity/1</span>
      </div>
      <p className="mt-4 text-[20px] font-semibold tracking-[-0.01em] text-[#E8E1D5]">{name}</p>
      <ul className="mt-4 space-y-2 border-t border-white/8 pt-4">
        {lines.map((line) => (
          <li key={line} className="font-mono text-[12px] text-white/55">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConnectSection({
  title,
  lead,
  command,
  steps,
  agents,
}: {
  title: string;
  lead: string;
  command: string;
  steps: string[];
  agents: string;
}) {
  return (
    <section id="connect" className="border-t border-white/8">
      <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-16">
          <div>
            <SectionHead title={title} lead={lead} />
            <ol className="mt-8 space-y-4">
              {steps.map((step, index) => (
                <li key={step} className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] tabular-nums text-white/40">
                    0{index + 1}
                  </span>
                  <span className="text-[14px] text-white/65">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-8 max-w-[420px] border-l border-[#C8622D]/50 pl-4 text-[13px] leading-[1.7] text-white/50">
              {agents}
            </p>
          </div>

          <div className="self-start border border-white/10 bg-[#0C0E11]">
            <div className="flex items-center gap-1.5 border-b border-white/8 px-4 py-2.5">
              <span className="size-2 rounded-full bg-white/12" />
              <span className="size-2 rounded-full bg-white/12" />
              <span className="size-2 rounded-full bg-white/12" />
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/32">
                shell
              </span>
            </div>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.8] text-white/65">
              <span className="text-white/28">$ </span>
              {command}
              {"\n"}
              <span className="text-white/28">{"{"}</span>
              {"\n  "}
              <span className="text-[#C8622D]">&quot;world&quot;</span>
              <span className="text-white/28">: </span>
              <span className="text-white/70">&quot;reach&quot;</span>
              <span className="text-white/28">,</span>
              {"\n  "}
              <span className="text-[#C8622D]">&quot;schemas&quot;</span>
              <span className="text-white/28">: {"{ "}</span>
              <span className="text-white/70">&quot;entity&quot;</span>
              <span className="text-white/28">: </span>
              <span className="text-white/70">&quot;/api/reach/schema/entity-1.json&quot;</span>
              <span className="text-white/28">{" }"}</span>
              {"\n"}
              <span className="text-white/28">{"}"}</span>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function Closing({ line, cta }: { line: string; cta: string }) {
  return (
    <section className="border-t border-white/8">
      <div className="mx-auto flex max-w-[1320px] flex-col items-start gap-8 px-4 py-20 sm:px-6 sm:py-24 lg:flex-row lg:items-end lg:justify-between lg:px-8">
        <h2 className="max-w-[14ch] text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-[#E8E1D5] sm:text-[2.6rem]">
          {line}
        </h2>
        <Link href="#create" className={heroButtonClassName("solid")}>
          {cta}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
