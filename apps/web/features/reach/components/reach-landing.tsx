import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "./marketing-chrome";
import { heroButtonClassName } from "@/features/landing/components/shared";
import { WorldPreview } from "./world-preview";
import { WorldPoster } from "./world-poster";
import { HeroHeadline } from "./hero-headline";
import { worldCopyForLocale } from "../i18n";
import type { SupportedLocale } from "@auro/core/i18n";
import { SITE_URL, brandForLocale } from "@/lib/brand";

const ACCENT = "#C8622D";

export function ReachLanding({ locale }: { locale: SupportedLocale }) {
  const copy = worldCopyForLocale(locale);
  const brand = brandForLocale(locale);

  return (
    <main className="min-h-full bg-[#0A0B0E] text-[#E8E1D5] selection:bg-[#C8622D]/30">
      <section id="world" className="relative">
        <MarketingHeader locale={locale} />

        <div className="mx-auto max-w-[1320px] px-4 pb-10 pt-[76px] sm:px-6 lg:px-8 lg:pb-8">
          {/* The claim sits above the world, so a visitor reads what this is
              before deciding whether the map is worth their attention. */}
          <div className="pt-7 sm:pt-9 lg:pt-11">
            <HeroHeadline copy={copy.hero} slogan={brand.slogan} />
            <p className="mt-4 text-title-sm font-medium text-[#dc895e]">{brand.genre}</p>
            <p className="mt-4 max-w-[600px] text-balance text-[15.5px] leading-[1.65] text-white/58 sm:text-[16px]">
              {brand.intro}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-3">
              <Link href="#create" className={heroButtonClassName("solid")}>
                {brand.play}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link href="#world" className={heroButtonClassName("ghost")}>
                {brand.world}
              </Link>
              <span className="text-[13px] text-white/48">{copy.note}</span>
            </div>
          </div>

          <WorldPreview locale={locale} copy={{ clock: copy.clock, feed: copy.feed, map: copy.map, explorer: copy.explorer }}>
            <WorldPoster label={copy.map.label} />
          </WorldPreview>

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
        command={`curl -fsS ${SITE_URL}/.well-known/reach.json`}
        steps={copy.connect.steps}
        agents={copy.connect.agents}
      />

      <section className="border-t border-white/8" aria-labelledby="world-faq">
        <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="world-faq" className="text-title-lg font-semibold">{brand.faqTitle}</h2>
          <dl className="mt-8 grid gap-8 md:grid-cols-3">
            {brand.faq.map(({ question, answer }) => (
              <div key={question}>
                <dt className="text-body-lg font-medium">{question}</dt>
                <dd className="mt-3 text-body leading-relaxed text-white/55">{answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <Closing line={brand.value} cta={brand.play} />

      <MarketingFooter locale={locale} />
    </main>
  );
}

// ---------------------------------------------------------------------------

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
    <section id="rules" className="border-t border-white/8">
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
              <span aria-hidden className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/32">
                curl
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
