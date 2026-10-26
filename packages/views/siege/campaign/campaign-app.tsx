import { useCanvasResolution } from "../use-canvas-resolution";
import { createSiegeClient, siegeSessionOptions, type SiegeScope } from "@auro/core/siege/queries";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BookOpen, Check, Coins, Download, Flag, Hammer, Heart, Map, Pause, Play, Plus, RotateCcw, Settings2, Shield, Snowflake, Sparkles, Swords, Target, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@auro/ui/components/ui/dialog";
import { CAMPAIGN_HEIGHT, CAMPAIGN_LEVELS, CAMPAIGN_WIDTH, compileCampaignWeapon, createCannonDrawing, createCannonSpec, DEFAULT_CANNON, ENEMY_RECIPES, presetBlueprint, RULES_VERSION, sellPrice, unlockedLevel, upgradePrice, WEAPON_RECIPES,
  type Blueprint, type CampaignBlueprint, type CampaignCheckpoint, type CannonDesign, type WeaponKind, type SiegePlatform } from "@auro/core/siege";
import { loadArenaArt } from "../arena/art";
import { paintBattle } from "./painter";
import type { CampaignEngine, CampaignSnapshot } from "./engine";
import { createCampaignStorage, defaultLoadout } from "./storage";
import { GameSound } from "../../common/game-sound";
import { AppLink } from "../../navigation";

const kinds = Object.keys(WEAPON_RECIPES) as WeaponKind[];
const weaponIcons = { cannon: Target, frost: Snowflake, blade: Swords, hammer: Hammer, burst: Sparkles };
const emptySnapshot = (levelId: number): CampaignSnapshot => ({ tick: 0, phase: "ready", wave: 1, completedWaves: 0, gold: CAMPAIGN_LEVELS[levelId - 1]!.gold, hp: 100, kills: 0, paused: false, towers: [], enemies: [], obstacles: [], leaks: [], focus: null, stars: 0, revision: 0, remainingSpawns: 0, activeRounds: 0, roundLimit: 96 });

export interface CampaignAppProps {
  platform: SiegePlatform;
  scope: SiegeScope;
  /** The workspace drawing workshop destination. */
  workshopHref: string;
}

export function CampaignApp({ platform, scope, workshopHref }: CampaignAppProps) {
  const { workspaceId, workspaceSlug, userId } = scope;
  const api = useMemo(() => createSiegeClient({ workspaceId, workspaceSlug, userId }), [workspaceId, workspaceSlug, userId]);
  const store = useMemo(() => createCampaignStorage(platform), [platform]);
  const paperStyle = useMemo(
    () => ({ "--siege-paper": `url("${platform.assetUrl("workshop-paper")}")` }) as CSSProperties,
    [platform],
  );
  const [initial] = useState(() => ({ progress: store.readProgress(), ...store.readCheckpoint(), ...store.readLoadout() }));
  const [progress, setProgress] = useState(initial.progress);
  const [levelId, setLevelId] = useState(initial.checkpoint?.levelId ?? Math.min(initial.progress.selectedLevel, unlockedLevel(initial.progress.stars)));
  const [restart, setRestart] = useState(0), [retryLoad, setRetryLoad] = useState(0);
  const [snapshot, setSnapshot] = useState<CampaignSnapshot>(() => emptySnapshot(levelId));
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState(initial.invalid ? "旧断点无法恢复，历史星级仍保留。" : initial.invalidLoadout ? "旧改装无法使用，已恢复预设。" : initial.checkpoint ? `已恢复第 ${initial.checkpoint.completedWaves + 1} 波前的防线，点击开始继续。` : "");
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null), [selectedKind, setSelectedKind] = useState<WeaponKind>("cannon");
  const [loadout, setLoadout] = useState(initial.loadout);
  const [speed, setSpeed] = useState<1 | 2>(initial.progress.speed), [levelsOpen, setLevelsOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sessionId] = useState(() => platform.preferences.getItem("siege.session") ?? "");
  const library = useQuery({ ...siegeSessionOptions(api, scope, sessionId), enabled: settingsOpen && !!sessionId });
  const resume = useRef<CampaignCheckpoint | null>(initial.checkpoint);
  const engine = useRef<CampaignEngine | null>(null), canvas = useRef<HTMLCanvasElement>(null);
  const controls = useRef({ speed, selectedSlot, selectedKind, loadout }); controls.current = { speed, selectedSlot, selectedKind, loadout };
  const sound = useRef<GameSound | null>(null);
  const redraw = useRef<(() => void) | null>(null);
  useCanvasResolution(canvas, CAMPAIGN_WIDTH / CAMPAIGN_HEIGHT, redraw);
  useEffect(() => { redraw.current?.(); }, [selectedSlot, selectedKind, loadout]);
  const recordedResult = useRef<CampaignEngine | null>(null);
  const level = CAMPAIGN_LEVELS[levelId - 1]!;
  const selected = snapshot.towers.find(t => t.slot === selectedSlot);
  const compiled = useMemo(() => Object.fromEntries(kinds.map(k => [k, compileCampaignWeapon(k, loadout[k])])) as Record<WeaponKind, ReturnType<typeof compileCampaignWeapon>>, [loadout]);
  const weapon = compiled[selectedKind];
  const preview = useRef({ range: weapon.range, color: WEAPON_RECIPES[selectedKind].color });
  preview.current = { range: weapon.range, color: WEAPON_RECIPES[selectedKind].color };
  const obstacle = selectedSlot === null ? null : level.obstacles.find(o => o.slot === selectedSlot && (snapshot.obstacles.find(s => s.id === o.id)?.hp ?? o.hp) > 0);
  const finished = snapshot.phase === "victory" || snapshot.phase === "defeat";
  const previewWave = level.waves[Math.min(snapshot.completedWaves, level.waves.length - 1)]!;
  const enemyKinds = [...new Set(previewWave.map(e => e.kind))];

  useEffect(() => {
    if (!store.writeProgress(progress)) setNotice("浏览器无法保存进度，本次仍可继续。请允许本地存储后重试。");
    if (sound.current) { sound.current.enabled = progress.sound; sound.current.volume = progress.volume; }
  }, [progress, store]);
  useEffect(() => { if (!store.writeLoadout(loadout)) setNotice("改装未能保存，本次仍可部署。请允许浏览器本地存储。"); }, [loadout, store]);
  useEffect(() => {
    const audio = new GameSound(); sound.current = audio; audio.enabled = progress.sound; audio.volume = progress.volume;
    return () => { audio.dispose(); sound.current = null; };
    // The sound preference is updated independently; changing it must not restart audio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let disposed = false, raf = 0, world: CampaignEngine | null = null;
    setReady(false); setError(""); setSnapshot(emptySnapshot(levelId));
    const ctx = canvas.current?.getContext("2d");
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const visibility = () => {
      if (document.visibilityState === "hidden" && world && !["victory", "defeat"].includes(world.phase)) {
        world.setPaused(true); setSnapshot(world.snapshot());
      }
    };
    const blur = () => { if (world && !["victory", "defeat"].includes(world.phase)) { world.setPaused(true); setSnapshot(world.snapshot()); redraw.current?.(); } };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    Promise.all([import("./engine").then(async runtime => { await runtime.initializePhysics(); return runtime; }), loadArenaArt(platform.assetUrl, "campaign")]).then(([runtime, art]) => {
      if (disposed) return;
      const checkpoint = resume.current?.levelId === levelId ? resume.current : undefined;
      world = new runtime.CampaignEngine(CAMPAIGN_LEVELS[levelId - 1]!, checkpoint); resume.current = null;
      engine.current = world; sound.current?.reset(); setSnapshot(world.snapshot()); setReady(true);
      let last = 0, accumulator = 0, lastHUD = 0, lastRevision = -1, lastCheckpoint = "", heardTick = -1, priorLeaks = world.leaks.length;
      const frame = (now: number) => {
        raf = 0;
        if (disposed || !world) return;
        const elapsed = Math.min(0.1, last ? (now - last) / 1000 : 0); last = now;
        if (!world.paused && document.visibilityState === "visible" && ["running", "intermission"].includes(world.phase)) accumulator += elapsed * controls.current.speed;
        else accumulator = 0;
        let steps = 0;
        while (accumulator >= 1 / 60 && steps++ < 15) { world.step(); accumulator -= 1 / 60; }
        if (ctx) paintBattle(ctx, world, art, controls.current.selectedSlot, media.matches, preview.current);
        if (world.tick > heardTick) {
          if ([...world.towers.values()].some(t => t.lastShot > heardTick)) sound.current?.play("shot", world.tick);
          const latest = world.effects.at(-1);
          if (latest && latest.tick > heardTick) sound.current?.play(latest.kind === "gold" ? "gold" : "hit", world.tick);
          if (world.leaks.length > priorLeaks) sound.current?.play("leak", world.tick);
          priorLeaks = world.leaks.length; heardTick = world.tick;
        }
        const checkpointKey = `${world.phase}:${world.completedWaves}:${world.revision}`;
        if (["ready", "intermission"].includes(world.phase) && checkpointKey !== lastCheckpoint) {
          const saved = world.checkpoint();
          if (saved && !store.writeCheckpoint(saved)) setNotice("波间断点未能保存，本次战斗仍可继续。");
          lastCheckpoint = checkpointKey;
        }
        if (["victory", "defeat"].includes(world.phase) && recordedResult.current !== world) {
          recordedResult.current = world; store.clearCheckpoint();
          const result = world.snapshot();
          sound.current?.play(result.phase as "victory" | "defeat", world.tick);
          if (result.phase === "victory") setProgress(previous => ({ ...previous, stars: previous.stars.map((stars, index) => index === levelId - 1 ? Math.max(stars, result.stars) : stars) }));
        }
        if (now - lastHUD >= 100 || world.revision !== lastRevision) { setSnapshot(world.snapshot()); lastHUD = now; lastRevision = world.revision; }
        if (!world.paused && document.visibilityState === "visible" && ["running", "intermission"].includes(world.phase)) raf = requestAnimationFrame(frame);
      };
      redraw.current = () => { if (!disposed && !raf) { last = 0; raf = requestAnimationFrame(frame); } };
      redraw.current();
    }).catch(() => { if (!disposed) setError("战场加载失败，进度仍保留。请重试加载。"); });
    return () => {
      disposed = true; redraw.current = null; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", blur);
      if (engine.current === world) engine.current = null;
      world?.dispose();
    };
    // A running battle owns immutable blueprint snapshots; drafts do not recreate it.
  }, [levelId, restart, retryLoad, store, platform]);

  const update = () => { if (engine.current) setSnapshot(engine.current.snapshot()); redraw.current?.(); };
  const act = (action: () => string | null, cue?: "upgrade" | "gold") => {
    void sound.current?.activate(); const issue = action(); setNotice(issue ?? "");
    if (!issue && cue) sound.current?.play(cue, engine.current?.tick); update();
  };
  const togglePause = () => { if (engine.current) { engine.current.setPaused(!engine.current.paused); update(); } };
  const pauseForPanel = (open: boolean) => { if (open && engine.current && !finished) { engine.current.setPaused(true); update(); } };
  const focusObstacle = (id: string, slot: number | null) => {
    engine.current?.setFocus(snapshot.focus === `obstacle:${id}` ? null : `obstacle:${id}`); setSelectedSlot(slot); update();
  };
  const chooseLevel = (id: number) => {
    resume.current = null; store.clearCheckpoint(); setLevelId(id); setRestart(n => n + 1); setSelectedSlot(null); setSelectedKind("cannon"); setLevelsOpen(false); setNotice("");
    setProgress(previous => ({ ...previous, selectedLevel: id }));
  };
  const applyBlueprint = async (blueprint: CampaignBlueprint) => {
    const hash = await platform.drawingHash(blueprint.drawing);
    if (blueprint.rulesVersion !== RULES_VERSION || blueprint.spec.drawingHash !== hash) throw new Error("蓝图需要在工坊按当前规则重新确认。");
    const kind: WeaponKind = blueprint.spec.parts.some(p => p.type === "cannon") ? "cannon" : blueprint.spec.parts.some(p => p.type === "hammer") ? "hammer" : "blade";
    if (!level.weapons.includes(kind)) throw new Error(`${WEAPON_RECIPES[kind].name}在第 ${WEAPON_RECIPES[kind].unlock} 关解锁。`);
    compileCampaignWeapon(kind, blueprint);
    setLoadout(previous => ({ ...previous, [kind]: blueprint })); setSelectedKind(kind); setNotice("蓝图已载入，新部署生效。现有武器保持本次参数。");
  };
  const importSaved = async (saved: Blueprint) => {
    setImporting(true);
    try {
      if (!saved.spec || saved.rulesVersion !== RULES_VERSION) throw new Error("这份蓝图需要在工坊按当前规则重新确认部件。");
      await applyBlueprint({ name: saved.name, drawing: saved.drawing, spec: saved.spec, cannonDesign: saved.cannonDesign, rulesVersion: RULES_VERSION });
    } catch (issue) { setNotice(issue instanceof Error ? issue.message : "蓝图无法载入。"); }
    finally { setImporting(false); }
  };
  const importDraft = async () => {
    setImporting(true); pauseForPanel(true);
    try {
      const draft = await platform.loadDraft(); if (!draft) throw new Error("工坊还没有草稿，先去工坊保存一个设计。");
      const drawing = draft.mode === "cannon" ? createCannonDrawing(draft.cannonDesign) : draft.freehand.drawing;
      const hash = await platform.drawingHash(drawing);
      const spec = draft.mode === "cannon" ? createCannonSpec(drawing, hash) : draft.freehand.spec;
      if (!spec || spec.drawingHash !== hash) throw new Error("草稿需要在工坊确认部件后才能部署。");
      const blueprint: CampaignBlueprint = { name: draft.mode === "cannon" ? draft.cannonName : draft.freehand.name, drawing, spec, cannonDesign: draft.mode === "cannon" ? draft.cannonDesign : null, rulesVersion: RULES_VERSION };
      await applyBlueprint(blueprint);
    } catch (issue) { setNotice(issue instanceof Error ? issue.message : "草稿无法载入。"); }
    finally { setImporting(false); }
  };
  const exportBattle = () => {
    const current = engine.current; if (!current) return;
    platform.download(new Blob([JSON.stringify({ version: 1, levelId, result: current.snapshot(), blueprints: [...current.towers.values()].map(tower => ({ towerId: tower.id, slot: tower.slot, blueprint: tower.weapon.blueprint })), events: current.events, eventsTruncated: current.events.length >= 2000 }, null, 2)], { type: "application/json" }), `siege-level-${levelId}.json`);
  };
  const adjustCannon = (parameter: "barrelLengthMm" | "barrelWidthMm", value: number) => {
    const design: CannonDesign = { ...DEFAULT_CANNON, ...(loadout[selectedKind].cannonDesign ?? {}), [parameter]: value };
    setLoadout(previous => ({ ...previous, [selectedKind]: presetBlueprint(selectedKind, design) }));
  };

  const buildAction = <Button disabled={!ready || selectedSlot === null || snapshot.gold < weapon.cost || finished} onClick={() => act(() => engine.current!.build(selectedSlot!, selectedKind, loadout[selectedKind]), "upgrade")}><Plus size={16} />建造 · {weapon.cost} 金币</Button>;
  const upgradeAction = selected && <Button disabled={selected.level >= 3 || snapshot.gold < upgradePrice(selected.cost, selected.level) || finished} onClick={() => act(() => engine.current!.upgrade(selected.id), "upgrade")}><Plus size={16} />{selected.level === 3 ? "已达最高等级" : `升级 · ${upgradePrice(selected.cost, selected.level)} 金币`}</Button>;
  const sellAction = selected && <Button variant="outline" disabled={finished} onClick={() => act(() => engine.current!.sell(selected.id), "gold")}>出售 · 返还 {sellPrice(selected.cost, selected.level)} 金币</Button>;
  const clearAction = obstacle && <Button variant={snapshot.focus === `obstacle:${obstacle.id}` ? "brand" : "default"} disabled={!ready || finished} onClick={() => focusObstacle(obstacle.id, obstacle.slot)}><Target size={16} />{snapshot.focus === `obstacle:${obstacle.id}` ? "取消清障" : "集火清障"}</Button>;

  const startButton = <Button size="sm" disabled={!ready || finished} onClick={() => { if (["ready", "intermission"].includes(snapshot.phase)) { if (!snapshot.towers.length) { setNotice("先点一个阵位，建造你的第一座武器。"); return; } act(() => engine.current!.startWave()); } else togglePause(); }}>{["ready", "intermission"].includes(snapshot.phase) ? <><Play size={16} />{snapshot.completedWaves ? "开始下一波" : "开始进攻"}</> : snapshot.paused ? <><Play size={16} />继续战斗</> : <><Pause size={16} />暂停布阵</>}</Button>;

  return <main className="campaign-app" style={paperStyle} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
      const world = engine.current; if (world && world.phase === "running") { world.setPaused(true); update(); }
    }
  }}>
    <header className="campaign-header">
      <span className="campaign-wordmark">Doodle<span>Siege<span className="campaign-dot">.</span></span></span>
      <nav aria-label="游戏导航"><AppLink href={workshopHref} onClick={() => pauseForPanel(true)}><ArrowLeft size={15} />武器工坊</AppLink>
        <Button variant="ghost" size="icon" aria-label={progress.sound ? "关闭音效" : "开启音效"} onClick={() => { setProgress(p => ({ ...p, sound: !p.sound })); if (!progress.sound) { if (sound.current) sound.current.enabled = true; void sound.current?.activate(); } }}>{progress.sound ? <Volume2 /> : <VolumeX />}</Button>
        <Dialog open={helpOpen} onOpenChange={open => { pauseForPanel(open); setHelpOpen(open); }}><DialogTrigger render={<Button variant="ghost" size="icon" aria-label="玩法帮助" />}><BookOpen /></DialogTrigger><DialogContent className="campaign-dialog"><DialogHeader><DialogTitle>守住你的纸上防线</DialogTitle></DialogHeader>
          <p>点阵位建造。击败敌人赚金币，升级强化效果；出售返还已投入金币的 70%。</p><p>点击障碍或敌人集火，射程外的武器继续自动防守。清障会开放新阵位。战前不能免费攻击障碍。</p><p>三颗星分别来自通关、城堡无伤和障碍全清。最后一个敌人处理完就会结算，记得提前安排清障。</p><p>刷新或离开战场回到最近完成波次后的断点。工坊改装只影响新部署；减速不叠加，首领控制效果减半。</p>
          <Button onClick={() => setHelpOpen(false)}>知道了</Button></DialogContent></Dialog>
      </nav>
    </header>
    <section className="campaign-heading"><div><span className="campaign-eyebrow">THE WOODLAND CAMPAIGN / 01</span><h1>林地防线<span>一笔一座，守住这一程。</span></h1></div>
      <Dialog open={levelsOpen} onOpenChange={open => { pauseForPanel(open); setLevelsOpen(open); }}><DialogTrigger render={<Button variant="outline" />}><Map size={17} />选关<span className="campaign-star-count">{progress.stars.reduce((a, b) => a + b, 0)} / 24 ★</span></DialogTrigger>
        <DialogContent className="campaign-dialog campaign-level-dialog"><DialogHeader><DialogTitle>林地之旅</DialogTitle></DialogHeader><div className="campaign-levels">{CAMPAIGN_LEVELS.map(item => {
          const locked = item.id > unlockedLevel(progress.stars);
          return <button key={item.id} type="button" className={"campaign-level " + (item.id === levelId ? "active" : "")} disabled={locked} onClick={() => chooseLevel(item.id)}><span className="campaign-level-number">{String(item.id).padStart(2, "0")}</span><strong>{item.name}</strong><span>{locked ? "上一关通关后解锁" : item.note}</span><span className="campaign-level-stars" aria-label={`${progress.stars[item.id - 1]} 颗星`}>{"★".repeat(progress.stars[item.id - 1]!)}{"☆".repeat(3 - progress.stars[item.id - 1]!)}</span></button>;
        })}</div></DialogContent>
      </Dialog>
    </section>

    <div className="campaign-layout">
      <section className="campaign-battle" aria-label="战场" data-testid="campaign-battle" data-phase={snapshot.phase} data-tick={snapshot.tick} data-hp={snapshot.hp} data-kills={snapshot.kills} data-completed-waves={snapshot.completedWaves}>
        <div className="campaign-toolbar"><div className="campaign-level-title"><span>{String(levelId).padStart(2, "0")}</span><div><h2>{level.name}</h2><span>{level.note}</span></div></div>
          <div className="campaign-hud"><span className="campaign-hp"><Heart size={17} /><b data-testid="campaign-hp">{snapshot.hp}</b><small>/ 100</small></span><span className="campaign-gold"><Coins size={17} /><b data-testid="campaign-gold">{snapshot.gold}</b></span><span><Flag size={16} /><b>{snapshot.wave}</b><small>/ {level.waves.length} 波</small></span></div>{startButton}
        </div>
        <div className="campaign-field">
          <canvas ref={canvas} width={1200} height={700} role="img" aria-label="林地战场，道路、炮台、敌人与城堡" />
          <div className="campaign-points">{level.slots.map((p, index) => {
            const occupied = snapshot.towers.find(t => t.slot === index);
            const blocked = level.obstacles.find(o => o.slot === index && (snapshot.obstacles.find(s => s.id === o.id)?.hp ?? o.hp) > 0);
            if (blocked) return null;
            return <button type="button" key={index} disabled={!ready || finished} aria-label={`阵位 ${index + 1}${occupied ? `，${WEAPON_RECIPES[occupied.kind].name} ${occupied.level} 级` : ""}`} aria-pressed={selectedSlot === index} className={`campaign-slot ${occupied ? "occupied" : "empty"} ${selectedSlot === index ? "selected" : ""}`} style={{ left: `${p.x / CAMPAIGN_WIDTH * 100}%`, top: `${p.y / CAMPAIGN_HEIGHT * 100}%` }} onClick={() => setSelectedSlot(index)}>{!occupied && <Plus size={20} />}</button>;
          })}{level.obstacles.map(o => (snapshot.obstacles.find(s => s.id === o.id)?.hp ?? o.hp) > 0 && <button type="button" key={o.id} disabled={!ready || finished} className={"campaign-obstacle " + (snapshot.focus === `obstacle:${o.id}` ? "focused" : "")} style={{ left: `${o.x / CAMPAIGN_WIDTH * 100}%`, top: `${o.y / CAMPAIGN_HEIGHT * 100}%` }} aria-label={`${o.kind === "crate" ? "木箱" : o.kind === "stump" ? "树桩" : "宝箱"}，奖励 ${o.reward} 金币`} onClick={() => focusObstacle(o.id, o.slot)}><span>+{o.reward}</span></button>)}
            {snapshot.enemies.map(e => <button type="button" key={e.id} className="campaign-enemy-target" disabled={finished} style={{ left: `${e.x / CAMPAIGN_WIDTH * 100}%`, top: `${e.y / CAMPAIGN_HEIGHT * 100}%` }} aria-label={`集火${ENEMY_RECIPES[e.kind].name} ${e.id}`} onClick={() => { engine.current?.setFocus(`enemy:${e.id}`); update(); }} />)}
          </div>
          {!ready && <div className="campaign-loading" role="status">{error ? <><strong>{error}</strong><Button onClick={() => setRetryLoad(n => n + 1)}>重试加载</Button></> : <><Shield className="campaign-loading-icon" /><span>正在铺开你的防线…</span></>}</div>}
          {ready && snapshot.paused && !finished && <div className="campaign-paused"><Pause size={14} />已暂停 · 可以继续布阵</div>}
          {ready && snapshot.phase === "intermission" && !snapshot.paused && <div className="campaign-paused"><Flag size={14} />本波守住了 · 下一波准备中</div>}
          {ready && finished && <div className="campaign-result" role="status"><div className="campaign-result-card"><span className="campaign-eyebrow">{snapshot.phase === "victory" ? "DEFENSE COMPLETE" : "TRY ANOTHER WAY"}</span><h2>{snapshot.phase === "victory" ? "这一程，守住了。" : "再画一道防线。"}</h2>
            <div className="campaign-result-stars" aria-label={`${snapshot.stars} 颗星`}>{"★".repeat(snapshot.stars)}{"☆".repeat(3 - snapshot.stars)}</div>
            <p>{snapshot.phase === "victory" ? `城堡 ${snapshot.hp} HP · 击败 ${snapshot.kills} 个敌人` : snapshot.leaks.length ? `第 ${snapshot.leaks.at(-1)!.wave} 波，${ENEMY_RECIPES[snapshot.leaks.at(-1)!.kind].name}突破了路线 ${snapshot.leaks.at(-1)!.route + 1}。` : "城堡失守了。"}</p>
            <div className="campaign-result-actions">{snapshot.phase === "victory" && levelId < 8 && <Button onClick={() => chooseLevel(levelId + 1)}>下一关<ArrowRight size={17} /></Button>}<Button variant={snapshot.phase === "defeat" ? "default" : "outline"} onClick={() => chooseLevel(levelId)}><RotateCcw size={16} />重试本关</Button></div>
            {snapshot.phase === "victory" && levelId === 8 && <p>林地八关已完成。回到选关，挑战你的三颗星。</p>}
          </div></div>}
        </div>
        <div className="campaign-controls"><div className="campaign-control-left"><Button size="icon" variant="ghost" disabled={!ready || !["running", "intermission"].includes(snapshot.phase)} aria-label={snapshot.paused ? "继续战斗" : "暂停战斗"} onClick={togglePause}>{snapshot.paused ? <Play /> : <Pause />}</Button><Button variant={speed === 2 ? "brand" : "ghost"} size="sm" aria-pressed={speed === 2} onClick={() => { const next = speed === 1 ? 2 : 1; setSpeed(next); setProgress(previous => ({ ...previous, speed: next })); }}>{speed}×</Button><span className="campaign-battle-time">{Math.floor(snapshot.tick / 60 / 60)}:{String(Math.floor(snapshot.tick / 60) % 60).padStart(2, "0")}</span></div>
          {snapshot.focus && <Button variant="ghost" size="sm" onClick={() => { engine.current?.setFocus(null); update(); }}><X size={14} />取消集火</Button>}
          <span className="campaign-control-status">{snapshot.phase === "ready" ? "准备布防" : finished ? "本次战斗结束" : snapshot.activeRounds >= snapshot.roundLimit ? "炮弹已达上限，等待命中后继续发射" : `${snapshot.enemies.length} 个在场 · ${snapshot.remainingSpawns} 个待出场`}</span>
        </div>
        {selectedSlot !== null && ready && !finished && <section className="campaign-mobile-actions" aria-label="阵位操作"><div><strong>{obstacle ? "清出新阵位" : selected ? selected.name : WEAPON_RECIPES[selectedKind].name}</strong><span>阵位 {selectedSlot + 1}{selected ? ` · ${selected.level} 级` : obstacle ? ` · ${Math.ceil(snapshot.obstacles.find(o => o.id === obstacle.id)?.hp ?? obstacle.hp)} HP` : ` · ${weapon.range.toFixed(1)} m`}</span></div><div className="campaign-quick-buttons">{obstacle ? clearAction : selected ? <>{upgradeAction}{sellAction}</> : buildAction}</div></section>}
        <div className="campaign-weapon-tray" role="group" aria-label="选择武器">{kinds.map(kind => {
          const recipe = WEAPON_RECIPES[kind], Icon = weaponIcons[kind], locked = !level.weapons.includes(kind);
          return <button key={kind} type="button" disabled={locked || finished} aria-pressed={selectedKind === kind} className={"campaign-weapon " + (selectedKind === kind ? "active" : "")} onClick={() => setSelectedKind(kind)} style={{ "--weapon-color": recipe.color } as React.CSSProperties}><span className="campaign-weapon-icon"><Icon size={25} /></span><strong>{recipe.name}</strong><span>{recipe.tag}</span><b>{locked ? `第 ${recipe.unlock} 关` : <><Coins size={12} />{compiled[kind].cost}</>}</b></button>;
        })}</div>
      </section>

      <aside className="campaign-sidebar" aria-label="布阵与波次">
        <section className="campaign-build-panel"><span className="campaign-eyebrow">YOUR NEXT MOVE</span>
          {obstacle ? <><h2>{obstacle.kind === "crate" ? "打开这只木箱" : obstacle.kind === "stump" ? "清出新阵位" : "值得这笔投资吗？"}</h2><p>剩余 {Math.ceil(snapshot.obstacles.find(o => o.id === obstacle.id)?.hp ?? obstacle.hp)} HP · 奖励 {obstacle.reward} 金币</p><div className="campaign-sidebar-action">{clearAction}</div><p className="campaign-small">清障会占用射程内的火力，留意道路末端。</p></> : selected ? <><h2>{selected.name}</h2><span className="campaign-selected-label">阵位 {selected.slot + 1} · {selected.level} 级</span><div className="campaign-tower-facts"><span>实际伤害<b>{selected.damage}</b></span><span>击败<b>{selected.kills}</b></span><span>控制命中<b>{selected.control}</b></span></div>
            <div className="campaign-sidebar-action">{upgradeAction}</div>
            {selected.level < 3 && <p className="campaign-small">伤害倍率 {selected.level === 1 ? "1.00 → 1.45" : "1.45 → 2.05"}；几何保持不变。</p>}
            <div className="campaign-sidebar-action">{sellAction}</div></> : <><h2>{selectedSlot === null ? "第一步，选个好位置。" : `阵位 ${selectedSlot + 1}`}</h2><p>{selectedSlot === null ? "点地图上的 +，布置你的武器。弯道与道路末端各有用处。" : WEAPON_RECIPES[selectedKind].detail}</p>
            <div className="campaign-blueprint-name">{loadout[selectedKind].name}</div><div className="campaign-design-facts"><span>{weapon.definition.launcher ? "射程" : "覆盖"}<b>{weapon.range.toFixed(1)} m</b></span><span>材料<b>{weapon.definition.ink} / 100</b></span></div>
            <div className="campaign-sidebar-action">{buildAction}</div>
            {snapshot.gold < weapon.cost && <p className="campaign-small">还差 {weapon.cost - snapshot.gold} 金币。</p>}
          </>}
          <Dialog open={settingsOpen} onOpenChange={open => { pauseForPanel(open); setSettingsOpen(open); }}><DialogTrigger render={<Button variant="ghost" size="sm" />}><Settings2 size={15} />战前改装与蓝图</DialogTrigger><DialogContent className="campaign-dialog"><DialogHeader><DialogTitle>下一座武器，按你的设计。</DialogTitle></DialogHeader>
            <p>改装只影响之后新建的武器，现有防线保留部署时的形状与性能。</p>
            <label className="campaign-range-label" htmlFor="campaign-barrel">炮管长度<span>{((loadout[selectedKind].cannonDesign?.barrelLengthMm ?? 2200) / 1000).toFixed(2)} m</span></label><input id="campaign-barrel" type="range" min={1600} max={3200} step={50} disabled={!loadout[selectedKind].cannonDesign} value={loadout[selectedKind].cannonDesign?.barrelLengthMm ?? 2200} onChange={event => adjustCannon("barrelLengthMm", Number(event.target.value))} />
            <p className="campaign-small">更长提高射程和弹速，也增加材料、装填时间与转向负担。</p>
            <label className="campaign-range-label" htmlFor="campaign-width">炮管粗细<span>{((loadout[selectedKind].cannonDesign?.barrelWidthMm ?? 950) / 1000).toFixed(2)} m</span></label><input id="campaign-width" type="range" min={450} max={1050} step={50} disabled={!loadout[selectedKind].cannonDesign} value={loadout[selectedKind].cannonDesign?.barrelWidthMm ?? 950} onChange={event => adjustCannon("barrelWidthMm", Number(event.target.value))} />
            <p className="campaign-small">更粗提高伤害，也增加材料与转向负担。</p><div className="campaign-design-facts"><span>价格<b>{weapon.cost}</b></span><span>射程／覆盖<b>{weapon.range.toFixed(1)} m</b></span>{weapon.definition.launcher && <span>单发／装填<b>{weapon.definition.launcher.damage} / {(weapon.definition.launcher.reloadTicks / 60).toFixed(1)} s</b></span>}</div>
            <Button variant="outline" disabled={importing} aria-busy={importing} onClick={() => void importDraft()}>使用工坊草稿</Button><Button variant="ghost" onClick={() => { setLoadout(defaultLoadout()); setNotice("已恢复预设，现有武器不受影响。"); }}>恢复全部预设</Button>{sessionId && <div className="campaign-library"><strong>已保存蓝图</strong>{library.isPending ? <p>读取中…</p> : library.isError ? <><p>蓝图暂时无法读取，可继续使用本地设计。</p><Button variant="outline" size="sm" onClick={() => void library.refetch()}>重试读取</Button></> : !library.data?.blueprints.length ? <p>工坊还没有保存蓝图。</p> : library.data.blueprints.map(saved => <Button key={saved.id} variant="outline" size="sm" disabled={importing} onClick={() => void importSaved(saved)}>使用蓝图：{saved.name}</Button>)}</div>}{notice && <p role="status">{notice}</p>}<label className="campaign-range-label" htmlFor="campaign-volume">音量<span>{Math.round(progress.volume * 100)}%</span></label><input id="campaign-volume" type="range" min={0} max={1} step={0.1} value={progress.volume} onChange={event => setProgress(previous => ({ ...previous, volume: Number(event.target.value) }))} /><p className="campaign-small">离开战场进入工坊，将从最近的波间断点继续。</p><AppLink className="campaign-workshop-link" href={workshopHref}>去武器工坊<ArrowRight size={15} /></AppLink><Button onClick={() => setSettingsOpen(false)}><Check size={16} />完成改装</Button>
          </DialogContent></Dialog>
        </section>
        <section className="campaign-wave-panel"><div className="campaign-section-label"><Flag size={16} /><h2>{snapshot.phase === "ready" || snapshot.phase === "intermission" ? "下一波" : "本波来袭"}</h2><span>{previewWave.length} 个{enemyKinds.includes("boss") ? "＋援军" : ""}</span></div><div className="campaign-enemy-list">{enemyKinds.map(kind => <div key={kind}><span className={`campaign-enemy-dot ${kind}`} /><div><strong>{ENEMY_RECIPES[kind].name}</strong><span>{ENEMY_RECIPES[kind].detail}</span></div><b>×{previewWave.filter(e => e.kind === kind).length}</b></div>)}</div>
          {level.routes.length > 1 && <div className="campaign-route-note">双入口 · 下一波从 {Array.from(new Set(previewWave.map(e => e.route + 1))).join("、")} 号路进攻</div>}
        </section>
        <section className="campaign-note"><span className="campaign-eyebrow">FIELD NOTES</span><p>{level.lesson}</p><div className="campaign-goals"><span><Shield size={14} />守住城堡</span><span><Heart size={14} />无伤通关</span><span><Coins size={14} />障碍全清</span></div></section>
      </aside>
    </div>
    {notice && <div className="campaign-notice" role="status"><span>{notice}</span><Button variant="ghost" size="icon-xs" aria-label="关闭提示" onClick={() => setNotice("")}><X size={14} /></Button></div>}
    <footer className="campaign-footer"><span>纸上防线 · 林地篇</span><div><Button variant="ghost" size="sm" disabled={!ready} onClick={exportBattle}><Download size={14} />导出战斗记录</Button><Button variant="ghost" size="sm" disabled={!ready} onClick={() => chooseLevel(levelId)}><RotateCcw size={14} />重开本关</Button></div></footer>
  </main>;
}
