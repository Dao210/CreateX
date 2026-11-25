"use client";
import { useMemo, useState, type ReactNode, type RefObject } from "react";
import { Crosshair, ChevronDown } from "lucide-react";
import {
  DecisionSchema,
  emptyDecision,
  type BattleEvent,
  type Frame,
  type Unit,
} from "@auro/core/capture-the-flag";
import { parseWithFallback } from "@auro/core/api";
import { Button } from "@auro/ui/components/ui/button";
import { useT } from "../i18n";
import { BattleCanvas } from "./battle-canvas";
import { ATLAS_URL } from "./battle-art";

export function battleTime(time: number) {
  return `${Math.floor(time / 60)
    .toString()
    .padStart(2, "0")}:${(time % 60).toFixed(2).padStart(5, "0")}`;
}
export function UnitPortrait({
  unit,
  large = false,
}: {
  unit: Pick<Unit, "unitType" | "team">;
  large?: boolean;
}) {
  const col =
    unit.unitType === "heavy_infantry"
      ? 0
      : unit.unitType === "cavalry"
        ? 50
        : 100;
  return (
    <span
      aria-hidden
      className={`ctf-unit-portrait${large ? " ctf-unit-portrait-large" : ""}`}
      style={{
        backgroundImage: `url("${ATLAS_URL}")`,
        backgroundPosition: `${col}% ${unit.team === "red" ? 0 : 100}%`,
      }}
    />
  );
}
const movementKeys = [
  "MOVE_TOWARD",
  "MOVE_AWAY_FROM",
  "FOLLOW",
  "GUARD",
  "INTERCEPT",
  "HOLD_POSITION",
  "RETURN_TO_OWN_FLAG",
  "GO_TO_ENEMY_FLAG",
  "GO_TO_DROPPED_FLAG",
] as const;
const specialKeys = [
  "CAPTURE_ENEMY_FLAG",
  "PICK_UP_ENEMY_DROPPED_FLAG",
  "RETURN_OWN_DROPPED_FLAG",
  "PICK_UP_FLAG",
  "DROP_CARRIED_FLAG",
  "DELIVER_FLAG",
  "NONE",
] as const;
const fieldKeys = [
  "game.time",
  "self.hp",
  "self.hp_percent",
  "self.is_flag_carrier",
  "self.is_capturing",
  "self.capture_progress",
  "self.death_count",
  "self.attack_ready",
  "nearest_enemy.distance",
  "nearby_enemy.count",
  "nearby_ally.count",
  "own_flag.state",
  "enemy_flag.state",
  "enemy.has_flag_carrier",
  "ally.has_flag_carrier",
] as const;

export function BattleView({
  frame,
  playing,
  interval = 250,
  controls,
  stageMeta,
  stageRef,
  timeline = [],
  onSeek,
  selectedId,
  onSelect,
}: {
  frame: Frame;
  playing: boolean;
  interval?: number;
  controls: ReactNode;
  stageMeta?: ReactNode;
  stageRef?: RefObject<HTMLDivElement | null>;
  timeline?: Frame[];
  onSeek?: (index: number) => void;
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const { t } = useT("ctf");
  const [localSelected, setLocalSelected] = useState("red_archer");
  const selected = selectedId ?? localSelected;
  const setSelected = onSelect ?? setLocalSelected;
  const unit = frame.units.find((u) => u.id === selected) ?? frame.units[0]!;
  const decision = useMemo(
    () =>
      frame.decisions[unit.id] === undefined
        ? emptyDecision
        : parseWithFallback(
            frame.decisions[unit.id],
            DecisionSchema,
            emptyDecision,
            { endpoint: "ctf/decision", redact: true },
          ),
    [frame.decisions, unit.id],
  );
  const unitName = (u: Unit) =>
    `${t(($) => $[u.team])} · ${t(($) => $[u.unitType])}`;
  const targetName = (id: string | null, text: string) => {
    const target = frame.units.find((u) => u.id === id);
    return target
      ? unitName(target)
      : text && text !== "无"
        ? text
        : t(($) => $.tactics.noTarget);
  };
  const flagLabel = (state: string | undefined) =>
    state === "AT_HOME"
      ? t(($) => $.tactics.flagHome)
      : state === "CARRIED"
        ? t(($) => $.tactics.flagCarried)
        : state === "DROPPED"
          ? t(($) => $.tactics.flagDropped)
          : t(($) => $.unknown);
  const stateOf = (u: Unit) =>
    !["ALIVE", "RESPAWNING", "ELIMINATED"].includes(u.state)
      ? t(($) => $.unknown)
      : u.state === "RESPAWNING"
        ? t(($) => $.tactics.respawning, {
            seconds: u.respawnRemaining.toFixed(2),
          })
        : u.state === "ELIMINATED"
          ? t(($) => $.tactics.eliminated)
          : u.isFlagCarrier
            ? t(($) => $.tactics.carrying)
            : u.isCapturing
              ? t(($) => $.tactics.capturing, {
                  seconds: u.captureProgress.toFixed(2),
                })
              : (u.shootLockTicks ?? 0) > 0
                ? t(($) => $.tactics.shootingLock)
                : t(($) => $.tactics.alive);
  const movement = movementKeys.find((key) => key === decision.movement);
  const special = specialKeys.find((key) => key === decision.special) ?? "NONE";
  const formatFact = (value: unknown) =>
    typeof value === "number"
      ? Number(value.toFixed(2)).toString()
      : value === true
        ? t(($) => $.tactics.yes)
        : value === false
          ? t(($) => $.tactics.no)
          : typeof value === "string"
            ? value
            : t(($) => $.unknown);
  const [eventFilter, setEventFilter] = useState("key");
  const events = useMemo(() => {
    const map = new Map<string, { event: BattleEvent; index: number }>();
    for (const [index, f] of timeline.entries())
      for (const event of f.events ?? [])
        if (!map.has(event.id)) map.set(event.id, { event, index });
    for (const event of frame.events ?? [])
      if (!map.has(event.id))
        map.set(event.id, { event, index: Math.max(0, timeline.length - 1) });
    return [...map.values()]
      .filter(
        ({ event }) =>
          event.kind !== "unknown" &&
          (eventFilter === "all" || event.kind !== "attack"),
      )
      .slice(-80)
      .reverse();
  }, [timeline, frame.events, eventFilter]);
  const eventText = (event: BattleEvent) => {
    const actor = frame.units.find((u) => u.id === event.unitId),
      target = frame.units.find((u) => u.id === event.targetId);
    const name = actor ? unitName(actor) : t(($) => $[event.team]);
    if (event.kind === "attack")
      return t(($) => $.tactics.attackEvent, {
        actor: name,
        target: target ? unitName(target) : t(($) => $.unknown),
        damage: event.damage,
      });
    if (event.kind === "death")
      return t(($) => $.tactics.deathEvent, { actor: name });
    if (event.kind === "respawn")
      return t(($) => $.tactics.respawnEvent, { actor: name });
    const state = flagLabel(event.flagState);
    return t(($) => $.tactics.flagEvent, {
      team: t(($) => $[event.team]),
      state,
    });
  };
  return (
    <div className="ctf-workbench">
      <div className="ctf-battle-column">
        <div className="ctf-stage" ref={stageRef}>
          <div className="ctf-field-heading">
            <span>
              <Crosshair aria-hidden />
              {t(($) => $.tactics.battlefield)}
            </span>
            <span className="ctf-spawn-key" title={t(($) => $.zones.spawnHelp)}>
              <i aria-hidden />
              {t(($) => $.zones.spawnLegend)}
            </span>
            <div>
              {(["red", "blue"] as const).map((side) => (
                <span key={side} className={`ctf-flag-state ctf-${side}`}>
                  {t(($) => $[side])}{" "}
                  <b>{flagLabel(frame.flags[side].state)}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="ctf-battlefield">
            <BattleCanvas
              frame={frame}
              label={t(($) => $.tactics.battlefield)}
              selectedId={unit.id}
              targetId={decision.movement_target_id ?? undefined}
              onSelect={setSelected}
              playing={playing}
              interval={interval}
            />
            {frame.result && (
              <div
                className="ctf-battle-result"
                data-winner={frame.result.winner}
                role="status"
              >
                <span>
                  {frame.result.winner === "red"
                    ? t(($) => $.redWin)
                    : frame.result.winner === "blue"
                      ? t(($) => $.blueWin)
                      : frame.result.winner === "draw"
                        ? t(($) => $.draw)
                        : t(($) => $.unknown)}
                </span>
              </div>
            )}
          </div>
          {stageMeta}
        </div>
        {controls}
        <div
          className="ctf-unit-roster"
          aria-label={t(($) => $.tactics.unitRoster)}
        >
          {frame.units.map((u) => (
            <button
              type="button"
              key={u.id}
              className={`ctf-unit-card ctf-${u.team}`}
              aria-pressed={u.id === unit.id}
              title={`${t(($) => $.unitStats.range)} · ${t(($) => $.unitStats.cells, { value: u.range })}`}
              onClick={() => setSelected(u.id)}
            >
              <UnitPortrait unit={u} />
              <span className="ctf-unit-card-info">
                <strong>{unitName(u)}</strong>
                <span className="ctf-unit-hp">
                  {Math.round(u.hp)} <small>/ {u.maxHp}</small>
                </span>
                <span className="ctf-health-track">
                  <i
                    style={{ width: `${Math.max(0, (u.hp / u.maxHp) * 100)}%` }}
                  />
                </span>
                <span>{stateOf(u)}</span>
              </span>
            </button>
          ))}
        </div>
        <section className="ctf-event-timeline">
          <div className="ctf-section-head">
            <h2>{t(($) => $.tactics.timeline)}</h2>
            <div>
              <Button
                variant={eventFilter === "key" ? "brandSubtle" : "ghost"}
                size="xs"
                aria-pressed={eventFilter === "key"}
                onClick={() => setEventFilter("key")}
              >
                {t(($) => $.tactics.keyEvents)}
              </Button>
              <Button
                variant={eventFilter === "all" ? "brandSubtle" : "ghost"}
                size="xs"
                aria-pressed={eventFilter === "all"}
                onClick={() => setEventFilter("all")}
              >
                {t(($) => $.tactics.allEvents)}
              </Button>
            </div>
          </div>
          {events.length ? (
            <ol>
              {events.map(({ event, index }) => (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (actorId(event)) setSelected(actorId(event)!);
                      onSeek?.(index);
                    }}
                    disabled={!onSeek}
                  >
                    <time>{battleTime(event.time)}</time>
                    <span className={`ctf-event-dot ctf-event-${event.kind}`} />
                    <span>{eventText(event)}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t(($) => $.tactics.noEvents)}</p>
          )}
          <details className="ctf-raw-log">
            <summary>
              {t(($) => $.events)} <ChevronDown aria-hidden />
            </summary>
            <ol>
              {frame.logs
                .slice()
                .reverse()
                .map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
            </ol>
          </details>
        </section>
      </div>
      <aside className="ctf-inspector" aria-label={t(($) => $.decision)}>
        <div className="ctf-inspector-head">
          <div>
            <span>{t(($) => $.tactics.selectedUnit)}</span>
            <span>{t(($) => $.tactics.tick, { value: frame.tick })}</span>
          </div>
          <div className="ctf-inspector-unit">
            <UnitPortrait unit={unit} large />
            <div>
              <h2>{t(($) => $[unit.unitType])}</h2>
              <p className={`ctf-${unit.team}`}>
                {t(($) => $[unit.team])} · {stateOf(unit)}
              </p>
            </div>
          </div>
          <div className="ctf-inspector-metrics">
            <div>
              <span>{t(($) => $.unitStats.hp)}</span>
              <b>
                {Math.round(unit.hp)} / {unit.maxHp}
              </b>
            </div>
            <div>
              <span>{t(($) => $.tactics.position)}</span>
              <b>
                {unit.x.toFixed(1)}, {unit.y.toFixed(1)}
              </b>
            </div>
            <div className="ctf-range-metric">
              <span>{t(($) => $.unitStats.range)}</span>
              <b>{t(($) => $.unitStats.cells, { value: unit.range })}</b>
            </div>
          </div>
        </div>
        <div className="ctf-inspector-body">
          <section>
            <h3>
              <span>01</span>
              {t(($) => $.tactics.observation)}
            </h3>
            {unit.state !== "ALIVE" ? (
              <p>{stateOf(unit)}</p>
            ) : decision.observation_facts.length ? (
              <ul>
                {decision.observation_facts.slice(0, 6).map((fact, index) => {
                  const field = fieldKeys.find((key) => key === fact.source);
                  return (
                    <li key={index}>
                      {field ? t(($) => $.tactics.fields[field]) : fact.source}{" "}
                      <strong>{formatFact(fact.actual)}</strong>
                      <small>
                        {fact.negated ? t(($) => $.tactics.negated) : ""}{" "}
                        {fact.operator} {formatFact(fact.expected)}
                      </small>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>
                {decision.rule_name
                  ? t(($) => $.tactics.unconditional)
                  : t(($) => $.tactics.waiting)}
              </p>
            )}
          </section>
          <section>
            <h3>
              <span>02</span>
              {t(($) => $.tactics.rule)}
            </h3>
            {unit.state !== "ALIVE" ? (
              <p>{t(($) => $.tactics.inactive)}</p>
            ) : decision.rule_name ? (
              <>
                <p className="ctf-rule-name">{decision.rule_name}</p>
                <span className="ctf-priority">
                  {t(($) => $.tactics.priority, {
                    value: decision.rule_priority,
                  })}
                </span>
                {decision.matched_rules
                  .filter((r) => r.priority < decision.rule_priority)
                  .slice(0, 2)
                  .map((r, i) => (
                    <p className="ctf-alternative" key={i}>
                      {t(($) => $.tactics.lowerPriority, {
                        name: r.name,
                        value: r.priority,
                      })}
                    </p>
                  ))}
              </>
            ) : (
              <p>{t(($) => $.tactics.noRule)}</p>
            )}
          </section>
          <section>
            <h3>
              <span>03</span>
              {t(($) => $.tactics.action)}
            </h3>
            {unit.state !== "ALIVE" ? (
              <p>{stateOf(unit)}</p>
            ) : (
              <>
                <p>
                  {(unit.shootLockTicks ?? 0) > 0
                    ? t(($) => $.tactics.shootingLock)
                    : unit.isCapturing
                      ? t(($) => $.tactics.capturing, {
                          seconds: unit.captureProgress.toFixed(2),
                        })
                      : movement
                        ? t(($) => $.tactics.moves[movement])
                        : t(($) => $.unknown)}
                </p>
                {(decision.movement_target_id ||
                  (decision.movement_target &&
                    decision.movement_target !== "无")) && (
                  <p className="ctf-action-target">
                    {targetName(
                      decision.movement_target_id,
                      decision.movement_target,
                    )}
                  </p>
                )}
                <p>
                  {unit.isAttacking
                    ? t(($) => $.tactics.attacked, {
                        target: targetName(
                          decision.attack_target_id,
                          decision.attack_target,
                        ),
                      })
                    : decision.action_mode === "MOVE_ONLY"
                      ? t(($) => $.tactics.moveOnly)
                      : decision.attack !== "NO_ATTACK"
                        ? t(($) => $.tactics.attackWaiting)
                        : t(($) => $.tactics.noAttack)}
                </p>
                {special !== "NONE" && (
                  <p className="ctf-special-action">
                    {t(($) => $.tactics.specials[special])}
                  </p>
                )}
              </>
            )}
          </section>
          <div className="ctf-inspector-metrics">
            <div>
              <span>{t(($) => $.tactics.cooldown)}</span>
              <b>
                {t(($) => $.tactics.seconds, {
                  value: (unit.attackCooldown ?? 0).toFixed(2),
                })}
              </b>
            </div>
            <div>
              <span>{t(($) => $.tactics.deaths)}</span>
              <b>
                {t(($) => $.tactics.deathCount, { value: unit.deathCount })}
              </b>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
function actorId(event: BattleEvent) {
  return event.unitId || event.targetId;
}
