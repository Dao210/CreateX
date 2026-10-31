"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronRight, Flag, Gamepad2, Heart, LockKeyhole, Maximize2, Minimize2, Pause, Play, RotateCcw, Shield, Sparkles, Volume2, VolumeX } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import type { StorageAdapter } from "@auro/core/types";
import { TankProgressSync } from "./tank-progress-sync";
import { TankDefenseGame, TANK_LEVELS, TANK_DIFFICULTIES, parseTankPreferences, type TankDirection, type TankSnapshot, type TankBlueprint, type TankMode, type TankLevel, type TankDifficulty } from "@auro/core/tank-defense";
import { GameSound } from "../common/game-sound";
import { useT } from "../i18n";
import { PageHeader } from "../layout/page-header";
import { paintTankBattle } from "./painter";
import { useTankFullscreen } from "./use-tank-fullscreen";
import { TankPreview } from "./tank-preview";

const keyDirections: Record<string, TankDirection> = { ArrowUp: "up", KeyW: "up", ArrowRight: "right", KeyD: "right", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left" };
const movementKeys = ["W", "A", "S", "D"];
const fireKeys = ["SPACE", "J"];
const pauseKeys = ["P"];
const mapColors = { floor: "#17251c", brick: "#aa6244", steel: "#a5b6a2", water: "#497c88", forest: "#395a39", ice: "#a8c9ba" };
function MapPreview({ level }: { level: TankLevel }) {
  return <svg className="tank-map-preview" viewBox="0 0 52 52" aria-hidden>
    <rect width="52" height="52" fill={mapColors.floor} />
    {level.terrain.map((kind, i) => kind !== "floor" && <rect key={i} x={i % 26 * 2} y={Math.floor(i / 26) * 2} width="2" height="2" fill={mapColors[kind]} />)}
    <rect x="24" y="48" width="4" height="4" fill="#f1ca68" />
  </svg>;
}

interface TankBattleProps {
  storage: StorageAdapter;
  storageKey: string;
  workspaceId?: string;
  blueprint?: TankBlueprint;
  levelIndex?: number;
  initialMode?: TankMode;
  frozen?: boolean;
  garage?: ReactNode;
  headerActions?: ReactNode;
  onStart?: () => void;
  startPending?: boolean;
  startDisabled?: boolean;
  autoStart?: boolean;
  readyLoadout?: { name: string; blueprint: TankBlueprint };
  launchError?: string;
}

export function TankBattle({ storage, storageKey, workspaceId, blueprint, levelIndex = 0, initialMode = "campaign", frozen = false, garage, headerActions, onStart, startPending = false, startDisabled = false, autoStart = false, readyLoadout, launchError }: TankBattleProps) {
  const { t } = useT("tanks");
  const [preferences, setPreferences] = useState(() => {
    try { return parseTankPreferences(storage.getItem(storageKey)); }
    catch { return parseTankPreferences(null); }
  });
  const [game, setGame] = useState(() => {
    const initial = new TankDefenseGame(TANK_LEVELS[levelIndex]!, { playerBlueprint: blueprint, mode: initialMode, difficulty: preferences.difficulty });
    if (autoStart) initial.start();
    return initial;
  });
  const [snapshot, setSnapshot] = useState<TankSnapshot>(() => game.snapshot());
  const root = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<GameSound | null>(null);
  const held = useRef<string[]>([]), touchDirection = useRef<TankDirection | null>(null), touchFire = useRef(false);
  const announced = useRef<TankDefenseGame | null>(null);
  const finished = ["cleared", "victory", "defeat"].includes(snapshot.phase);
  const active = snapshot.phase === "running" && !snapshot.paused;
  const clearControls = () => { held.current = []; touchDirection.current = null; touchFire.current = false; game.clearInput(); };
  const focusBattlefield = () => canvas.current?.focus({ preventScroll: true });
  const pause = () => {
    clearControls(); game.setPaused(!game.paused); setSnapshot(game.snapshot());
    if (!game.paused) focusBattlefield();
  };
  const { fullscreen, supported: fullscreenSupported, failed: fullscreenFailed, toggle: toggleFullscreen } = useTankFullscreen(root, () => {
    clearControls(); game.setPaused(true); setSnapshot(game.snapshot()); focusBattlefield();
  });
  const start = () => { void audio.current?.activate(); audio.current?.reset(); game.start(); focusBattlefield(); setSnapshot(game.snapshot()); };
  const replaceGame = (levelIndex: number, carry = false, begin = false, mode: TankMode = game.mode, difficulty: TankDifficulty = game.difficulty) => {
    clearControls(); audio.current?.reset(); void audio.current?.activate();
    const next = new TankDefenseGame(TANK_LEVELS[levelIndex]!, carry ? { score: game.score, lives: game.lives, power: game.power, mode, difficulty, playerBlueprint: blueprint } : { mode, difficulty, playerBlueprint: blueprint });
    if (begin) next.start();
    setGame(next); setSnapshot(next.snapshot()); focusBattlefield();
  };

  useEffect(() => {
    if (fullscreen) canvas.current?.focus({ preventScroll: true });
  }, [fullscreen]);

  useEffect(() => {
    const sound = new GameSound(); audio.current = sound;
    if (autoStart) { void sound.activate(); focusBattlefield(); }
    return () => { sound.dispose(); audio.current = null; };
  }, [autoStart]);
  useEffect(() => {
    if (audio.current) audio.current.enabled = preferences.sound;
    try { storage.setItem(storageKey, JSON.stringify({ version: 1, ...preferences })); }
    catch { /* Local records are optional. */ }
  }, [storage, preferences, storageKey]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    let frameId = 0, last = 0, accumulator = 0, hudAt = 0;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncInput = () => {
      const lastDirection = [...held.current].reverse().find(code => code in keyDirections);
      game.setInput(touchDirection.current ?? (lastDirection ? keyDirections[lastDirection]! : null), touchFire.current || held.current.includes("Space") || held.current.includes("KeyJ"));
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || !root.current?.contains(document.activeElement)) return;
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable)) return;
      if (event.code === "Escape" && document.fullscreenElement === root.current) return;
      if (event.code === "KeyP" || event.code === "Escape") {
        if (!event.repeat && game.phase === "running") {
          event.preventDefault(); event.stopPropagation(); held.current = []; touchDirection.current = null; touchFire.current = false;
          game.setPaused(!game.paused); setSnapshot(game.snapshot());
        }
        return;
      }
      if (!(event.code in keyDirections) && event.code !== "Space" && event.code !== "KeyJ") return;
      if (document.activeElement !== canvas.current) return;
      event.preventDefault(); event.stopPropagation();
      if (game.phase !== "running" || game.paused) return;
      if (!held.current.includes(event.code)) held.current.push(event.code); syncInput();
    };
    const keyup = (event: KeyboardEvent) => { held.current = held.current.filter(code => code !== event.code); syncInput(); };
    const suspend = () => {
      held.current = []; touchDirection.current = null; touchFire.current = false; game.clearInput();
      if (game.phase === "running") { game.setPaused(true); setSnapshot(game.snapshot()); }
    };
    const visibility = () => { if (document.visibilityState === "hidden") suspend(); };
    window.addEventListener("keydown", keydown, true); window.addEventListener("keyup", keyup);
    window.addEventListener("blur", suspend); document.addEventListener("visibilitychange", visibility);
    const frame = (now: number) => {
      const elapsed = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      if (game.phase === "running" && !game.paused) accumulator += elapsed; else accumulator = 0;
      syncInput();
      let steps = 0;
      while (accumulator >= 1 / 60 && steps++ < 8) { game.step(); accumulator -= 1 / 60; }
      for (const cue of game.cues.splice(0)) audio.current?.play(cue, game.tick);
      paintTankBattle(ctx, game, motion.matches);
      if (["cleared", "victory", "defeat"].includes(game.phase) && announced.current !== game) {
        announced.current = game;
        setPreferences(previous => ({ ...previous, best: Math.max(previous.best, game.score), unlocked: game.mode === "campaign" && game.phase !== "defeat" ? Math.max(previous.unlocked, Math.min(TANK_LEVELS.length, game.level.id + 1)) : previous.unlocked }));
      }
      if (now - hudAt >= 80) { setSnapshot(game.snapshot()); hudAt = now; }
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId); game.clearInput(); held.current = [];
      window.removeEventListener("keydown", keydown, true); window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", suspend); document.removeEventListener("visibilitychange", visibility);
    };
  }, [game]);

  const control = (direction: TankDirection | null, fire = false) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (!active) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); focusBattlefield();
      if (fire) { touchFire.current = true; game.queueFire(); } else touchDirection.current = direction;
    },
    onPointerUp: () => { if (fire) touchFire.current = false; else touchDirection.current = null; },
    onPointerCancel: () => { if (fire) touchFire.current = false; else touchDirection.current = null; },
    onLostPointerCapture: () => { if (fire) touchFire.current = false; else touchDirection.current = null; },
  });
  const levels = TANK_LEVELS.map(level => ({ level, name: t($ => $.levels[level.key].name), note: t($ => $.levels[level.key].note) }));
  const selectedLevel = levels[game.level.id - 1]!;
  const modes = (["campaign", "blitz", "survival"] as const).map(mode => ({ mode, name: t($ => $.modes[mode].name), note: t($ => $.modes[mode].note) }));
  const selectedMode = modes.find(value => value.mode === game.mode)!;
  const difficulties = (["casual", "standard"] as const).map(difficulty => ({ difficulty, name: t($ => $.difficulties[difficulty].name), note: t($ => $.difficulties[difficulty].note) }));
  const selectedDifficulty = difficulties.find(value => value.difficulty === game.difficulty)!;
  const form = snapshot.power >= 2 ? "siege" : snapshot.power >= 1 ? "enhanced" : "basic";
  const fortifySeconds = Math.ceil(snapshot.fortifyTicks / 60);
  const inBattle = snapshot.phase === "running";
  const equipment = [
    { kind: "barrel", name: t($ => $.barrel), help: t($ => $.barrel_help) },
    { kind: "conveyor", name: t($ => $.conveyor), help: t($ => $.conveyor_help) },
    { kind: "pulse", name: t($ => $.pulse), help: t($ => $.pulse_help) },
    { kind: "repair", name: t($ => $.repair), help: t($ => $.repair_help) },
  ].filter(item => game.level.mechanisms.some(device => device.kind === item.kind));
  const overlayTitle = snapshot.phase === "ready" ? t($ => $.ready_title) : snapshot.paused ? t($ => $.paused_title) : snapshot.phase === "defeat" ? t($ => $.defeat_title) : snapshot.phase === "victory" ? t($ => $.victory_title) : t($ => $.cleared_title);
  const overlayHelp = snapshot.phase === "ready" ? t($ => $.ready_help, { lives: snapshot.maxLives }) : snapshot.paused ? t($ => $.paused_help) : snapshot.phase === "defeat" ? snapshot.defeatReason === "base" ? t($ => $.base_defeat) : snapshot.defeatReason === "time" ? t($ => $.time_defeat) : t($ => $.lives_defeat) : t($ => $.cleared_help, { kills: snapshot.kills, score: snapshot.score });

  return <main className="tank-defense-page" ref={root} data-fullscreen={fullscreen} data-testid="tank-defense-page" onBlur={event => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) && game.phase === "running") {
      clearControls(); game.setPaused(true); setSnapshot(game.snapshot());
    }
  }}>
    {workspaceId && <TankProgressSync workspaceId={workspaceId} preferences={preferences} onMerge={merged => setPreferences(previous => ({ ...previous, ...merged }))} />}
    <PageHeader>
      <Gamepad2 className="size-4 text-muted-foreground" aria-hidden />
      <h1 className="min-w-0 flex-1 truncate text-body font-medium">{t($ => $.title)}</h1>
      {!fullscreen && headerActions}
      <Button variant="ghost" size="icon" disabled={!fullscreenSupported} aria-label={fullscreen ? t($ => $.exit_fullscreen) : t($ => $.fullscreen)} aria-pressed={fullscreen} title={!fullscreenSupported ? t($ => $.fullscreen_unavailable) : fullscreen ? t($ => $.exit_fullscreen) : t($ => $.fullscreen)} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</Button>
      <Button variant="ghost" size="icon" aria-label={preferences.sound ? t($ => $.mute) : t($ => $.unmute)} aria-pressed={preferences.sound} onClick={() => {
        void audio.current?.activate(); setPreferences(value => ({ ...value, sound: !value.sound }));
      }}>{preferences.sound ? <Volume2 /> : <VolumeX />}</Button>
    </PageHeader>
    {fullscreenFailed && <p className="tank-fullscreen-error" role="alert">{t($ => $.fullscreen_error)}</p>}
    {launchError && <p className="tank-garage-error" role="alert">{launchError}</p>}
    <div className="tank-defense-app">
      <div className="tank-layout">
        <section className="tank-operation" aria-label={t($ => $.mode)}>
          <div className="tank-operation-controls"><div className="tank-mode-select" role="group" aria-label={t($ => $.mode)}>
            {modes.map(({ mode, name }, i) => <Button key={mode} variant="ghost" aria-pressed={game.mode === mode} disabled={inBattle || frozen} onClick={() => replaceGame(mode === "campaign" ? Math.min(game.level.id, preferences.unlocked) - 1 : game.level.id - 1, false, false, mode)}><span aria-hidden>{`0${i + 1}`}</span>{name}</Button>)}
          </div>
          <div className="tank-difficulty-select" role="group" aria-label={t($ => $.difficulty)}>
            {difficulties.map(({ difficulty, name }) => <Button key={difficulty} variant="ghost" aria-pressed={game.difficulty === difficulty} disabled={inBattle} onClick={() => {
              setPreferences(value => ({ ...value, difficulty })); replaceGame(game.level.id - 1, false, false, game.mode, difficulty);
            }}>{name}</Button>)}
          </div></div>
          <p>{inBattle ? t($ => $.mode_locked) : selectedMode.note}</p>
          {!inBattle && <p>{selectedDifficulty.note}</p>}
        </section>
        <section className="tank-machine" aria-label={t($ => $.battlefield)}>
          <div className="tank-scoreboard">
            <div><span>{t($ => $.score)}</span><strong data-testid="tank-score">{String(snapshot.score).padStart(6, "0")}</strong></div>
            <div className="tank-stage-number"><span>{t($ => $.stage)}</span><strong>{String(game.level.id).padStart(2, "0")}</strong></div>
            <div><span>{t($ => $.best)}</span><strong data-testid="tank-best">{String(Math.max(preferences.best, snapshot.score)).padStart(6, "0")}</strong></div>
          </div>
          <div className="tank-combat-status">
            <span>{selectedDifficulty.name}</span>
            <span><Heart size={13} aria-hidden />{t($ => $.lives)} {snapshot.lives}</span>
            <span><Shield size={13} aria-hidden />{t($ => $.armor)} {snapshot.playerHP}/{snapshot.maxPlayerHP}</span>
          </div>
          <div className="tank-screen-shell"><div className="tank-screen">
            <canvas ref={canvas} width={1040} height={1040} tabIndex={0} aria-label={t($ => $.battlefield)} data-testid="tank-battlefield" data-character-id={game.player?.blueprint.id ?? ""} data-player-speed={game.player?.blueprint.speed ?? ""} data-player-armor={game.player?.blueprint.armor ?? ""} data-power={snapshot.power} data-fortify-ticks={snapshot.fortifyTicks} data-difficulty={snapshot.difficulty} data-lives={snapshot.lives} data-player-hp={snapshot.playerHP} data-base-hp={snapshot.baseHP} data-mode={snapshot.mode} data-wave={snapshot.wave} data-time-left={snapshot.timeLeft ?? ""} data-phase={snapshot.phase} data-paused={snapshot.paused} data-player-x={snapshot.playerPosition?.x.toFixed(2) ?? ""} data-player-y={snapshot.playerPosition?.y.toFixed(2) ?? ""} data-shots={snapshot.shots} data-bricks={snapshot.destroyedBricks}>{t($ => $.ready_help, { lives: snapshot.maxLives })}</canvas>
            {(snapshot.phase === "ready" || snapshot.paused || finished) && <div className={"tank-overlay " + (snapshot.phase === "defeat" ? "tank-overlay-defeat" : "")}>
              <div className="tank-overlay-card">
                <div className="tank-overlay-emblem" aria-hidden>{snapshot.phase === "defeat" ? <Flag /> : snapshot.paused ? <Pause /> : <Shield />}</div>
                {snapshot.phase === "ready" && readyLoadout && <><TankPreview blueprint={readyLoadout.blueprint} name={readyLoadout.name} power={snapshot.power} className="mx-auto mb-2 size-24" /><strong>{readyLoadout.name}</strong></>}
                <h2>{overlayTitle}</h2>
                <p>{overlayHelp}</p>
                <div className="tank-overlay-actions">
                  {snapshot.phase === "ready" ? <Button size="lg" onClick={onStart ?? start} disabled={startDisabled || startPending} aria-busy={startPending}><Play />{startPending ? t($ => $.garage.deploying) : t($ => $.start)}<ArrowRight /></Button>
                    : snapshot.paused ? <><Button size="lg" onClick={pause}><Play />{t($ => $.resume)}</Button><Button variant="outline" size="lg" onClick={() => { setPreferences(value => ({ ...value, best: Math.max(value.best, game.score) })); replaceGame(game.level.id - 1); }}><Flag />{t($ => $.end_run)}</Button></>
                      : snapshot.phase === "cleared" ? <Button size="lg" onClick={() => replaceGame(game.level.id, true, true)}>{t($ => $.next)}<ArrowRight /></Button>
                        : <Button size="lg" onClick={() => replaceGame(snapshot.phase === "victory" && game.mode === "campaign" ? 0 : game.level.id - 1, false, true)}><RotateCcw />{snapshot.phase === "victory" ? t($ => $.again) : t($ => $.retry)}</Button>}
                </div>
              </div>
            </div>}
          </div></div>
          <div className="tank-hud-bar">
            <span>{selectedMode.name}{game.mode === "survival" && ` · ${t($ => $.wave, { wave: snapshot.wave })}`}</span>
            {snapshot.timeLeft !== null && <strong role="timer" className={snapshot.timeLeft <= 15 ? "tank-time-critical" : ""}>{t($ => $.time_left, { seconds: snapshot.timeLeft })}</strong>}
            {snapshot.intermission > 0 ? <strong aria-live="polite">{t($ => $.next_wave, { seconds: snapshot.intermission })}</strong> : snapshot.combo > 1 && <strong>{t($ => $.combo, { count: snapshot.combo })}</strong>}
            <span className="tank-hud-spacer" />
            <span className={snapshot.baseAlive ? "tank-base-safe" : "tank-base-lost"}><Shield size={14} />{!snapshot.baseAlive ? t($ => $.base_lost) : snapshot.baseHP < snapshot.maxBaseHP ? t($ => $.base_damaged) : t($ => $.base_safe)} {snapshot.baseHP}/{snapshot.maxBaseHP}</span>
            {snapshot.baseAlive && fortifySeconds > 0 && <strong role="timer" aria-label={t($ => $.fortify_timer)} className={fortifySeconds <= 3 ? "tank-fortify-timer tank-time-critical" : "tank-fortify-timer"}>{t($ => $.fortify_time, { seconds: fortifySeconds })}</strong>}
            <span>{snapshot.respawning ? t($ => $.respawn) : snapshot.stunned ? t($ => $.stunned) : snapshot.shield ? t($ => $.shielded) : t($ => $.protect_base)}</span>
            <Button variant="ghost" size="sm" disabled={snapshot.phase !== "running"} onClick={pause}>{snapshot.paused ? <Play /> : <Pause />}{snapshot.paused ? t($ => $.resume) : t($ => $.pause)}</Button>
          </div>
          <div className="tank-touch-controls">
            <div className="tank-dpad" role="group" aria-label={t($ => $.move_keys)}>
              <Button className="tank-dpad-up" variant="outline" size="icon-lg" disabled={!active} aria-label={t($ => $.up)} {...control("up")}><ArrowUp /></Button>
              <Button className="tank-dpad-left" variant="outline" size="icon-lg" disabled={!active} aria-label={t($ => $.left)} {...control("left")}><ArrowLeft /></Button>
              <span className="tank-dpad-center" />
              <Button className="tank-dpad-right" variant="outline" size="icon-lg" disabled={!active} aria-label={t($ => $.right)} {...control("right")}><ArrowRight /></Button>
              <Button className="tank-dpad-down" variant="outline" size="icon-lg" disabled={!active} aria-label={t($ => $.down)} {...control("down")}><ArrowDown /></Button>
            </div>
            <div className="tank-touch-fire"><Button size="lg" disabled={!active} aria-label={t($ => $.fire)} {...control(null, true)}>{t($ => $.fire)}</Button><span>{t($ => $.hold_fire)}</span></div>
          </div>
          <div className="tank-keyboard-hint">
            <span>{movementKeys.map(key => <kbd key={key}>{key}</kbd>)}{t($ => $.move_keys)}</span>
            <span>{fireKeys.map(key => <kbd key={key}>{key}</kbd>)}{t($ => $.fire_keys)}</span>
            <span><kbd>F</kbd>{t($ => $.fullscreen)}</span>
            <span>{pauseKeys.map(key => <kbd key={key}>{key}</kbd>)}{t($ => $.pause_keys)}</span>
          </div>
        </section>
        <aside className="tank-sidebar">
          <section className="tank-status-panel">
            <div className="tank-panel-label">{t($ => $.radio)}</div>
            <h2>{selectedLevel.name}</h2><p>{selectedLevel.note}</p>
            <div className="tank-lives"><span>{t($ => $.lives)}</span><div><Heart size={16} fill={snapshot.lives > 0 ? "currentColor" : "none"} /><strong>{snapshot.lives}</strong></div></div>
            <div className="tank-enemy-heading"><span>{t($ => $.remaining)}</span><strong data-testid="tank-remaining">{snapshot.remaining}<small>{` / ${snapshot.total}`}</small></strong></div>
            <div className="tank-enemy-grid" aria-label={t($ => $.remaining)}>{Array.from({ length: snapshot.total }, (_, i) => <svg key={i} viewBox="0 0 16 18" aria-hidden className={i < snapshot.waveKills ? "eliminated" : ""}><path d="M1 4h3v13H1zm11 0h3v13h-3zM5 5h6v11H5zM7 0h2v10H7z" fill="currentColor" /></svg>)}</div>
            <div className="tank-power"><span><Sparkles size={14} />{t($ => $.power)}</span><div>{[0, 1, 2].map(value => <span key={value} className={value <= snapshot.power ? "active" : ""} />)}</div><strong>{snapshot.power + 1}</strong></div>
            <p className="tank-form-name" role="status">{t($ => $.forms[form])}</p>
          </section>
          {garage}
          <section className="tank-map-select">
            <div className="tank-panel-label">{t($ => $.stages)}</div>
            {levels.map(({ level, name }) => <button key={level.id} type="button" disabled={(game.mode === "campaign" && level.id > preferences.unlocked) || inBattle || frozen} aria-pressed={level.id === game.level.id} className={level.id === game.level.id ? "selected" : ""} onClick={() => replaceGame(level.id - 1)}>
              <MapPreview level={level} /><span className="tank-map-index">{String(level.id).padStart(2, "0")}</span><span><strong>{name}</strong><small>{game.mode === "survival" ? t($ => $.endless_waves) : t($ => $.enemy_count, { count: level.enemies.length })}</small></span>
              {game.mode === "campaign" && level.id > preferences.unlocked ? <LockKeyhole size={14} /> : level.id < preferences.unlocked ? <Check size={14} /> : <ChevronRight size={14} />}
            </button>)}
            <p className="tank-map-help">{t($ => $.mode_help)}</p>
          </section>
          <section className="tank-equipment-guide">
            <div className="tank-panel-label">{t($ => $.mechanisms)}</div>
            {equipment.map(item => <details key={item.kind}><summary><i className={`tank-device-icon ${item.kind}`} aria-hidden />{item.name}</summary><p>{item.help}</p></details>)}
          </section>
          <section className="tank-field-guide">
            <div className="tank-panel-label">{t($ => $.terrain)}</div>
            <div className="tank-terrain-legend">
              <span><i className="brick" />{t($ => $.brick)}<small>{t($ => $.brick_help)}</small></span>
              <span><i className="steel" />{t($ => $.steel)}<small>{t($ => $.steel_help)}</small></span>
              <span><i className="water" />{t($ => $.water)}<small>{t($ => $.water_help)}</small></span>
              <span><i className="forest" />{t($ => $.forest)}<small>{t($ => $.forest_help)}</small></span>
              <span><i className="ice" />{t($ => $.ice)}<small>{t($ => $.ice_help)}</small></span>
            </div>
            <p>{t($ => $.supplies, { count: TANK_DIFFICULTIES[game.difficulty].supplyEvery })}</p><p className="tank-friendly-fire">{game.difficulty === "casual" ? t($ => $.friendly_fire_safe) : t($ => $.friendly_fire)}</p>
          </section>
        </aside>
      </div>
      <footer className="tank-footer">{t($ => $.local_records)}</footer>
    </div>
  </main>;
}
