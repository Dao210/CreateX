import type { WorldDict } from "@/features/landing/i18n/types";
import styles from "./hero-headline.module.css";

export function HeroHeadline({ copy, slogan }: { copy: WorldDict["hero"]; slogan: string }) {
  return (
    <h1 className={styles.headline}>
      {/* Keep the heading stable for assistive technology as the visual words rotate. */}
      <span className="sr-only">{slogan}</span>
      <span className={styles.visual} aria-hidden="true">
        <span className={styles.creation}>
          {copy.prefix}
          <span className={styles.wordWindow}>
            <span className={styles.track}>
              {copy.words.map((word) => <span key={word}>{word}</span>)}
              {/* The repeated first word makes the last upward transition seamless. */}
              <span>{copy.words[0]}</span>
            </span>
          </span>
          {copy.suffix}
          <span className={styles.separator}>{copy.separator}</span>
        </span>
        <span className={styles.world}>{copy.world}</span>
      </span>
    </h1>
  );
}
