"use client";
import { useState } from "react";
import type { Strategy, UnitType } from "@auro/core/capture-the-flag";
import { Button } from "@auro/ui/components/ui/button";
import { useT } from "../i18n";

export function StrategyOutline({ strategy }: { strategy: Strategy | null }) {
  const { t } = useT("ctf");
  const [type, setType] = useState<UnitType>("cavalry");
  if (!strategy) return null;
  const rules = [...strategy.strategies[type].rules].sort(
    (a, b) => b.priority - a.priority,
  );
  return (
    <section
      className="ctf-strategy-outline"
      aria-label={t(($) => $.tactics.ruleOutline)}
    >
      <div className="ctf-section-head">
        <h3>{t(($) => $.tactics.ruleOutline)}</h3>
        <div role="group" aria-label={t(($) => $.tactics.ruleOutline)}>
          {(["heavy_infantry", "cavalry", "archer"] as const).map((unit) => (
            <Button
              key={unit}
              size="xs"
              variant={type === unit ? "brandSubtle" : "ghost"}
              aria-pressed={type === unit}
              onClick={() => setType(unit)}
            >
              {t(($) => $[unit])}
            </Button>
          ))}
        </div>
      </div>
      {rules.length ? (
        <ol>
          {rules.map((rule, index) => (
            <li
              key={`${rule.id}:${index}`}
              data-disabled={rule.enabled === false || undefined}
            >
              <div>
                <strong>{rule.name}</strong>
                <span>
                  {t(($) => $.tactics.priority, { value: rule.priority })}
                  {rule.enabled === false &&
                    ` · ${t(($) => $.tactics.ruleDisabled)}`}
                </span>
              </div>
              <p>
                <code>{rule.movement.type}</code>
                <code>{rule.attack.type}</code>
                {rule.special.type !== "NONE" && (
                  <code>{rule.special.type}</code>
                )}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p>{t(($) => $.tactics.emptyRules)}</p>
      )}
    </section>
  );
}
