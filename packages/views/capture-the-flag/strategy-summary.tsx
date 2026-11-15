import type { Strategy } from "@auro/core/capture-the-flag";
import { useT } from "../i18n";
import { UnitPortrait } from "./battle-view";

export function StrategySummary({ strategy }: { strategy: Strategy }) {
  const { t } = useT("ctf");
  const mode = strategy.enhancement_mode ?? "standard";
  return (
    <div className="ctf-strategy-summary">
      <p className="ctf-strategy-mode">
        {t(($) => $.tactics.enhancement)}
        <strong>
          {mode === "standard"
            ? t(($) => $.tactics.standard)
            : t(($) => $[mode])}
        </strong>
      </p>
      <div className="ctf-rule-counts">
        {(["heavy_infantry", "cavalry", "archer"] as const).map((type) => (
          <div key={type}>
            <UnitPortrait unit={{ unitType: type, team: "red" }} />
            <span>
              <strong>{t(($) => $[type])}</strong>
              <small>
                {t(($) => $.files.ruleCount, {
                  count: strategy.strategies[type].rules.length,
                })}
              </small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
