import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "./marketing-chrome";
import { WorldPreview } from "./world-preview";
import { WorldPoster } from "./world-poster";
import { HeroHeadline } from "./hero-headline";
import { CreationDrawing } from "./creation-portrait";
import { worldCopyForLocale } from "../i18n";
import type { SupportedLocale } from "@auro/core/i18n";
import { SITE_URL, brandForLocale } from "@/lib/brand";
import { localizedHref } from "@/lib/marketing-urls";
import styles from "./reach-landing.module.css";

export function ReachLanding({ locale }: { locale: SupportedLocale }) {
  const copy = worldCopyForLocale(locale);
  const brand = brandForLocale(locale);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <MarketingHeader locale={locale} />
        <div className={`${styles.container} ${styles.heroInner}`}>
          <div className={styles.intro}>
            <p className={styles.genre}><span aria-hidden="true">✳</span>{brand.genre}</p>
            <HeroHeadline copy={copy.hero} slogan={brand.slogan} />
            <p className={styles.claim}><strong>{copy.claim}</strong> {copy.sub}</p>
            <div className={styles.heroActions}>
              <Link href="#world" prefetch={false} data-analytics-cta="hero_world" className={styles.primaryLink}>
                {brand.world}<ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link href={localizedHref("/login", locale)} prefetch={false} data-analytics-cta="hero_play" className={styles.secondaryLink}>
                {brand.play}
              </Link>
            </div>
          </div>
          <div id="world" className={styles.worldAnchor}>
            <WorldPreview locale={locale} copy={{ clock: copy.clock, feed: copy.feed, map: copy.map, explorer: copy.explorer }}>
              <WorldPoster label={copy.map.label} />
            </WorldPreview>
          </div>
        </div>
      </section>

      <section id="rules" className={`${styles.section} ${styles.rulesSection}`} aria-labelledby="rules-title">
        <div className={styles.container}>
          <SectionHead id="rules-title" index="01" title={copy.rules.title} lead={copy.rules.lead} />
          <div className={styles.rules}>
            {copy.rules.items.map((item) => (
              <article key={item.k} className={styles.rule}>
                <div className={styles.ruleMetric}><span>{item.k}</span><strong>{item.f}</strong></div>
                <div><h3>{item.t}</h3><p>{item.d}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="create" className={styles.section} aria-labelledby="create-title">
        <div className={styles.container}>
          <SectionHead id="create-title" index="02" title={copy.create.title} lead={copy.create.lead} />
          <div className={styles.specimens}>
            <SpecCard kind="weapon" {...copy.create.weapon} />
            <SpecCard kind="character" {...copy.create.character} />
          </div>
          <Link href="#connect" prefetch={false} data-analytics-cta="create_connect" className={styles.textLink}>
            {copy.create.cta}<ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section id="connect" className={`${styles.section} ${styles.connectSection}`} aria-labelledby="connect-title">
        <div className={`${styles.container} ${styles.connectGrid}`}>
          <div>
            <SectionHead id="connect-title" index="03" title={copy.connect.title} lead={copy.connect.lead} />
            <ol className={styles.steps}>
              {copy.connect.steps.map((step, index) => <li key={step}><span>0{index + 1}</span>{step}</li>)}
            </ol>
            <p className={styles.diagnostics}>{copy.connect.agents}</p>
          </div>
          <div className={styles.terminal}>
            <div className={styles.terminalBar} aria-hidden="true"><i /><i /><i /><span>curl</span></div>
            <pre><code>
              <span className={styles.codeDim}>$ </span>{`curl -fsS ${SITE_URL}/.well-known/reach.json\n`}
              <span className={styles.codeDim}>{"{\n  "}</span>
              <span className={styles.codeKey}>&quot;world&quot;</span>{': "reach",\n  '}
              <span className={styles.codeKey}>&quot;schemas&quot;</span>{': {\n    "entity": '}
              {'"/api/reach/schema/entity-1.json"\n  }\n'}
              <span className={styles.codeDim}>{"}"}</span>
            </code></pre>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.faqSection}`} aria-labelledby="world-faq">
        <div className={styles.container}>
          <SectionHead id="world-faq" title={brand.faqTitle} />
          <div className={styles.faqList}>
            {brand.faq.map(({ question, answer }) => (
              <details key={question} className={styles.faq}>
                <summary>{question}<Plus size={18} aria-hidden="true" /></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.closing}>
        <div className={`${styles.container} ${styles.closingInner}`}>
          <span className={styles.closingMark} aria-hidden="true">✳</span>
          <h2>{brand.value}</h2>
          <Link href={localizedHref("/login", locale)} prefetch={false} data-analytics-cta="closing_play" className={styles.primaryLink}>
            {brand.play}<ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>
      <MarketingFooter locale={locale} />
    </main>
  );
}

function SectionHead({ id, index, title, lead }: { id: string; index?: string; title: string; lead?: string }) {
  return (
    <div className={styles.sectionHead}>
      {index && <span className={styles.sectionIndex} aria-hidden="true">{index} /</span>}
      <h2 id={id}>{title}</h2>
      {lead && <p>{lead}</p>}
    </div>
  );
}

function SpecCard({ kind, label, name, lines }: { kind: "weapon" | "character"; label: string; name: string; lines: string[] }) {
  return (
    <article className={styles.specimen} data-kind={kind}>
      <div className={styles.specimenArt}>
        <span className={styles.specimenLabel}>{label}</span>
        <span className={styles.specimenIndex} aria-hidden="true">{kind === "weapon" ? "01" : "02"}</span>
        <svg viewBox="-90 -90 180 180" aria-hidden="true">
          <ellipse cy="56" rx="45" ry="9" fill="currentColor" opacity=".08" />
          <CreationDrawing entity={{ kind, silhouette: "broad", form: kind === "weapon" ? "blade" : "hammer", palette: ["#24332b", kind === "weapon" ? "#c88458" : "#819b80", "#e4ddc9"] }} />
        </svg>
      </div>
      <div className={styles.specimenBody}>
        <h3>{name}</h3>
        <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
    </article>
  );
}
