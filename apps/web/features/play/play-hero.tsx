"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SupportedLocale } from "@auro/core/i18n";
import { creationLoginHref } from "@/lib/creation-entry";
import { GAME_IDS, type GameId, type PlayCopy } from "./types";
import { GameplayVideo } from "./gameplay-video";
import media from "./media.json";
import styles from "./play-landing.module.css";

export function PlayHero({ locale, copy }: { locale: SupportedLocale; copy: PlayCopy }) {
  const [selected, setSelected] = useState<GameId>("tank");
  const [ready, setReady] = useState(false);
  const tabs = useRef<HTMLDivElement>(null);
  const id = useId();
  const game = copy.games[selected];
  useEffect(() => setReady(true), []);

  return (
    <div id="games" className={styles.heroGrid} data-game={selected}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}><span aria-hidden="true">✳</span>{copy.eyebrow}</p>
        <h1 className={styles.headline} aria-live="polite" aria-atomic="true"><span>{game.creation}</span><span>{game.experience}</span></h1>
        <p className={styles.intro}>{copy.intro}</p>
        <div ref={tabs} className={styles.tabs} role="tablist" aria-label={copy.choose}>
          {GAME_IDS.map((key, index) => <button key={key} type="button" role="tab" id={`${id}-${key}`} aria-selected={selected === key} aria-controls={`${id}-scene`} tabIndex={selected === key ? 0 : -1} disabled={!ready} onClick={() => setSelected(key)} onKeyDown={event => {
            const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
            if (next < 0) return;
            event.preventDefault(); setSelected(GAME_IDS[next]!); (tabs.current?.children[next] as HTMLButtonElement | undefined)?.focus();
          }}><span className={styles.tabNumber} aria-hidden="true">0{index + 1}</span>{copy.games[key].label}</button>)}
        </div>
      </div>
      <div id={`${id}-scene`} role="tabpanel" aria-labelledby={`${id}-${selected}`} className={styles.scene} tabIndex={0}>
        <div className={styles.sceneTop}><span className={styles.sceneMark} aria-hidden="true" /><span>{selected === "resident" ? copy.accelerated : copy.recorded}</span><span className={styles.sceneCount} aria-hidden="true">0{GAME_IDS.indexOf(selected) + 1} / 03</span></div>
        <GameplayVideo key={selected} media={media[selected]} label={game.sceneLabel} copy={copy} />
        <div className={styles.specimen}><span>{copy.example}</span><div><strong>{game.example}</strong><p>{game.exampleDetail}</p></div></div>
      </div>
      <div className={styles.heroActions}>
        <Link href={creationLoginHref(locale, selected)} prefetch={false} data-analytics-cta={`hero_create_${selected}`} className={styles.primaryLink}>{game.action}<ArrowRight size={17} aria-hidden="true" /></Link>
        <a href="#how-it-works" data-analytics-cta="hero_how" className={styles.secondaryLink}>{copy.how}</a>
      </div>
    </div>
  );
}
