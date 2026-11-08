import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { SupportedLocale } from "@auro/core/i18n";
import { brandForLocale } from "@/lib/brand";
import { creationLoginHref } from "@/lib/creation-entry";
import { MarketingFooter, MarketingHeader } from "@/features/reach/components/marketing-chrome";
import { playCopyForLocale } from "./copy";
import { PlayHero } from "./play-hero";
import gameplayBootstrap from "./gameplay-runtime.js?source";
import { GAME_IDS } from "./types";
import media from "./media.json";
import styles from "./play-landing.module.css";

export function PlayLanding({ locale }: { locale: SupportedLocale }) {
  const copy = playCopyForLocale(locale);
  const brand = brandForLocale(locale);
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <MarketingHeader locale={locale} />
        <div className={styles.container}><PlayHero locale={locale} copy={copy} /></div>
        <script dangerouslySetInnerHTML={{ __html: gameplayBootstrap }} />
      </section>
      <section id="create" className={styles.creations} aria-labelledby="creations-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}><span className={styles.sectionIndex} aria-hidden="true">01 /</span><h2 id="creations-title">{copy.gamesTitle}</h2><p>{copy.gamesLead}</p></div>
          <div className={styles.creationGrid}>{GAME_IDS.map((key, index) => {
            const game = copy.games[key];
            return <article key={key} className={styles.creationCard} data-game={key}>
              <div className={styles.cardPicture}>
                {/* eslint-disable-next-line @next/next/no-img-element -- The recording pipeline precompresses these hashed WebP stills. */}
                <img src={media[key].poster} width={960} height={600} alt={game.sceneLabel} decoding="async" loading="lazy" fetchPriority="low" /><span className={styles.cardMode}>{game.mode}</span>
              </div>
              <div className={styles.cardBody}><p className={styles.cardLabel}><span aria-hidden="true">0{index + 1}</span>{game.label}</p><h3>{game.experience}</h3><p className={styles.description}>{game.description}</p><Link href={creationLoginHref(locale, key)} prefetch={false} data-analytics-cta={`card_create_${key}`} className={styles.cardLink}>{game.action}<ArrowRight size={17} aria-hidden="true" /></Link></div>
            </article>;
          })}</div>
        </div>
      </section>
      <section id="how-it-works" className={styles.how} aria-labelledby="how-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}><span className={styles.sectionIndex} aria-hidden="true">02 /</span><h2 id="how-title">{copy.stepsTitle}</h2></div>
          <ol className={styles.steps}>{copy.steps.map((step, index) => <li key={step.title}><span className={styles.stepNumber} aria-hidden="true">0{index + 1}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}</ol>
        </div>
      </section>
      <section className={styles.faqSection} aria-labelledby="play-faq">
        <div className={`${styles.container} ${styles.faqGrid}`}>
          <div className={styles.sectionHead}><h2 id="play-faq">{brand.faqTitle}</h2></div>
          <div>{brand.faq.map(({ question, answer }) => <details key={question} className={styles.faq}><summary>{question}<Plus size={18} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
        </div>
      </section>
      <section className={styles.closing}><div className={`${styles.container} ${styles.closingInner}`}><span aria-hidden="true">✳</span><h2>{copy.closing}</h2><a href="#create" className={styles.primaryLink} data-analytics-cta="closing_choose">{copy.chooseFirst}<ArrowRight size={17} aria-hidden="true" /></a></div></section>
      <MarketingFooter locale={locale} />
    </main>
  );
}
