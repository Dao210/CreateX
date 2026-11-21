import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import type { SupportedLocale } from "@auro/core/i18n";
import { BrandMark } from "@auro/ui/components/common/brand-mark";
import enAuth from "@auro/views/locales/en/auth.json";
import zhAuth from "@auro/views/locales/zh-Hans/auth.json";
import jaAuth from "@auro/views/locales/ja/auth.json";
import koAuth from "@auro/views/locales/ko/auth.json";
import frAuth from "@auro/views/locales/fr/auth.json";
import { brandForLocale } from "@/lib/brand";
import { localizedHref } from "@/lib/marketing-urls";
import { playCopyForLocale } from "@/features/play/copy";
import type { GameId } from "@/features/play/types";
import media from "@/features/play/media.json";
import styles from "./login-shell.module.css";

const authCopy = { en: enAuth, "zh-Hans": zhAuth, ja: jaAuth, ko: koAuth, fr: frAuth };

export function LoginShell({ locale, creation, children }: {
  locale: SupportedLocale;
  creation: GameId | null;
  children: ReactNode;
}) {
  const brand = brandForLocale(locale);
  const copy = playCopyForLocale(locale);
  const auth = authCopy[locale].login_shell;
  const gameId = creation ?? "tank";
  const game = copy.games[gameId];

  return (
    <>
      <header className={styles.header}>
        <Link href={localizedHref("/", locale)} prefetch={false} className={styles.brand}>
          <BrandMark className={styles.brandMark} />
          <span translate="no">{brand.name}</span>
        </Link>
        <Link href={localizedHref("/#games", locale)} prefetch={false} className={styles.back}>
          <ArrowLeft size={16} aria-hidden="true" />
          {auth.back}
        </Link>
      </header>

      <main className={styles.main} data-creation={gameId}>
        <aside className={styles.showcase} aria-label={game.label}>
          <p className={styles.eyebrow}><span aria-hidden="true">✳</span>{copy.eyebrow}</p>
          <p className={styles.headline}><span>{game.creation}</span><span>{game.experience}</span></p>
          <p className={styles.intro}>{copy.intro}</p>
          <figure className={styles.scene}>
            <div className={styles.sceneTop}><span className={styles.sceneMark} aria-hidden="true" />{game.mode}</div>
            {/* eslint-disable-next-line @next/next/no-img-element -- Reuse the homepage's precompressed gameplay still without loading a game runtime. */}
            <img src={media[gameId].poster} width={960} height={600} alt={game.sceneLabel} decoding="async" loading="lazy" />
            <figcaption className={styles.caption}><span>{copy.example}</span><strong>{game.example}</strong><span>{game.exampleDetail}</span></figcaption>
          </figure>
        </aside>

        <section className={styles.signin} aria-label={auth.form_title}>
          {creation && <p className={styles.mobileContext}>{game.creation} {game.experience}</p>}
          <div className={styles.form}>{children}</div>
          <div className={styles.legal}>
            <a href={localizedHref("/privacy", locale)} target="_blank" rel="noreferrer">{auth.privacy}</a>
            <a href={localizedHref("/terms", locale)} target="_blank" rel="noreferrer">{auth.terms}</a>
          </div>
        </section>
      </main>
    </>
  );
}
