"use client";

import type { ReactNode } from "react";
import { BookOpen, TableProperties } from "lucide-react";
import { TICK_SECONDS, UNIT_STATS } from "@auro/core/capture-the-flag";
import { Button } from "@auro/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@auro/ui/components/ui/dialog";
import { useT } from "../i18n";

const unitTypes = ["heavy_infantry", "cavalry", "archer"] as const;
const guideSections = [
  "objective",
  "battlefield",
  "capture",
  "flags",
  "combat",
  "respawn",
  "strategy",
  "arena",
] as const;
const flagActions = [
  { action: 'PICK_UP_FLAG · flag: "OWN"', key: "pickOwn" },
  { action: 'PICK_UP_FLAG · flag: "ENEMY"', key: "pickEnemy" },
  { action: "DROP_CARRIED_FLAG", key: "drop" },
  { action: "RETURN_OWN_DROPPED_FLAG", key: "returnOwn" },
] as const;

function ReferenceDialog({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        {icon}
        {title}
      </DialogTrigger>
      <DialogContent className="ctf-reference-dialog sm:max-w-5xl">
        <DialogHeader className="ctf-reference-heading">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="ctf-reference-body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function CTFReference() {
  const { t } = useT("ctf");
  return (
    <>
      <ReferenceDialog
        title={t(($) => $.unitStats.title)}
        description={t(($) => $.unitStats.description)}
        icon={<TableProperties aria-hidden />}
      >
        <div
          className="ctf-reference-table-scroll"
          role="region"
          aria-label={t(($) => $.unitStats.title)}
          tabIndex={0}
        >
          <table className="ctf-reference-table">
            <thead>
              <tr>
                <th scope="col">{t(($) => $.unitStats.unit)}</th>
                <th scope="col">{t(($) => $.unitStats.hp)}</th>
                <th scope="col">{t(($) => $.unitStats.damage)}</th>
                <th scope="col">{t(($) => $.unitStats.speed)}</th>
                <th scope="col">{t(($) => $.unitStats.range)}</th>
                <th scope="col">{t(($) => $.unitStats.interval)}</th>
                <th scope="col">{t(($) => $.unitStats.action)}</th>
                <th scope="col">{t(($) => $.unitStats.enhancement)}</th>
              </tr>
            </thead>
            <tbody>
              {unitTypes.map((type) => {
                const stats = UNIT_STATS[type];
                const enhancedValue =
                  type === "heavy_infantry"
                    ? stats.maxHp * 2
                    : type === "cavalry"
                      ? stats.speed * 2
                      : stats.range * 2;
                return (
                  <tr key={type}>
                    <th scope="row">
                      <strong>{t(($) => $[type])}</strong>
                      <span>{t(($) => $.unitStats.roles[type])}</span>
                    </th>
                    <td>{stats.maxHp}</td>
                    <td>{stats.damage}</td>
                    <td>
                      {t(($) => $.unitStats.cellsPerSecond, {
                        value: stats.speed,
                      })}
                    </td>
                    <td>
                      {t(($) => $.unitStats.cells, { value: stats.range })}
                    </td>
                    <td>{t(($) => $.unitStats.oneSecond)}</td>
                    <td className="ctf-reference-text-cell">
                      {stats.moveAttack
                        ? t(($) => $.unitStats.moveAttack)
                        : t(($) => $.unitStats.moveOrAttack)}
                    </td>
                    <td className="ctf-reference-text-cell">
                      {t(($) => $.unitStats.enhancements[type], {
                        value: enhancedValue,
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="ctf-reference-notes">
          <p>{t(($) => $.unitStats.timing, { tick: TICK_SECONDS })}</p>
          <p>{t(($) => $.unitStats.archerTiming)}</p>
          <p>
            <code>{"enhancement_mode"}</code>{" "}
            {t(($) => $.unitStats.enhancementChoice)}
          </p>
        </div>
      </ReferenceDialog>
      <ReferenceDialog
        title={t(($) => $.guide.title)}
        description={t(($) => $.guide.description)}
        icon={<BookOpen aria-hidden />}
      >
        <article className="ctf-guide">
          {guideSections.map((section, index) => (
            <section key={section}>
              <h3>
                <span aria-hidden>{String(index + 1).padStart(2, "0")}</span>
                {t(($) => $.guide[section].title)}
              </h3>
              <p>{t(($) => $.guide[section].text)}</p>
              {section === "flags" && (
                <dl className="ctf-guide-actions">
                  {flagActions.map(({ action, key }) => (
                    <div key={key}>
                      <dt>
                        <code>{action}</code>
                      </dt>
                      <dd>{t(($) => $.guide.flagActions[key])}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p>{t(($) => $.guide[section].detail)}</p>
            </section>
          ))}
        </article>
      </ReferenceDialog>
    </>
  );
}
