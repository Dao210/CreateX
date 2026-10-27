import type { SiegeClient } from "@auro/core/siege";
import { createSiegeClient, siegeKeys, siegeLibraryOptions, siegeSessionOptions, siegeStatusOptions, type SiegeScope } from "@auro/core/siege/queries";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Crosshair, Download, Eraser, LoaderCircle, Pause, Pencil, Play, RotateCcw, Save, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { canonicalDrawing, CompileError, compileWeapon, emptyDrawing, initialStats, RULES_VERSION, SAMPLES, sampleSpec, SiegeError,
  DEFAULT_CANNON, createCannonDrawing, createCannonSpec, matchesCannonDesign,
  type Drawing, type Point, type PartType, type WeaponSpec, type WeaponDefinition, type SiegeSession, type ArenaMode, type CannonDesign, type WorkshopDraft, type FreehandDraft, type Blueprint, type SiegePlatform } from "@auro/core/siege";
import { DrawingCanvas, type CanvasTool } from "./editor/drawing-canvas";
import { Arena } from "./arena/siege-arena";
import { DesignMetrics, BattleMetrics } from "./workshop/metrics";
import { CannonWorkshop } from "./workshop/cannon-workshop";
import { useNavigation } from "../navigation";

const defaultDrawing = createCannonDrawing(DEFAULT_CANNON), placeholderHash = "0".repeat(64);
const defaultDefinition = compileWeapon(defaultDrawing, createCannonSpec(defaultDrawing, placeholderHash), placeholderHash, DEFAULT_CANNON);
const labels: Record<PartType, string> = { blade: "刀刃", hammer: "锤头", cannon: "火炮", wheel: "轮轴", shield: "盾牌", structure: "连接杆" };
const messages: Record<string, string> = {
  invalid_blueprint: "部件数据不完整，请重新确认。", drawing_changed: "画图已改变，请重新确认部件。",
  needs_confirmation: "先确认下方的识别疑问。", too_many_parts: "最多四个功能部件，可以把相同功能的笔画组合在一起。",
  multiple_axes: "这一版支持一个转轴。", overlapping_parts: "同一笔画不能属于两个部件。",
  disconnected_parts: "所有部件需要连接到同一个结构。", invalid_connection: "连接关系无效。",
  missing_mount: "点选转轴，然后在画布上选择安装点。", mount_outside_weapon: "安装点需要落在武器结构上。",
  detached_geometry: "部件需要在画布上相接，请补上连接结构。",
  complex_outline: "这个轮廓太复杂。试着分笔画，或简化为凸形轮廓。",
  wheel_not_round: "轮轴需要一个接近圆形的闭合轮廓。", collision_budget: "线条太复杂，请减少转折。",
  ink_budget: "这个设计超过 100 墨水，请缩小或简化。", empty_geometry: "先画出一个有尺寸的部件。",
  invalid_stroke_reference: "笔画引用已失效，请重新确认。", unassigned_strokes: "请给每条笔画确认一个部件。",
  network_unavailable: "连接中断，画图仍在。可以恢复原请求或稍后重试。",
  model_not_configured: "AI 识别尚未配置，可以使用手动标注。",
  model_unavailable: "这次识别未完成，画图仍在。重新识别会发起一次新请求。",
  model_invalid_response: "AI 返回了无法使用的部件，请手动修正或重新识别。",
  model_refused: "这张草图未能完成识别，可以手动标注部件。",
  model_incomplete: "识别输出未完成，请简化草图或手动标注。",
  recognition_unknown: "无法确认识别结果。恢复原请求不会重复调用模型。",
  fixture_not_found: "样例模式只识别旋转锤和自动炮台示例。自己的画图请使用手动标注。",
  version_conflict: "另一页面更新了存档。已刷新列表，请确认后重新保存。",
  capacity_reached: "存档已到容量上限。仍可导出本地蓝图。",
  recognition_budget: "识别预算已用完，手动标注仍可使用。",
  rate_limited: "操作过于频繁，请稍后再试。", invalid_response: "服务响应无法使用，画图仍在。",
  service_busy: "存档正在处理另一项操作，请稍后恢复结果或重试。",
  storage_unavailable: "存档服务暂时不可用，可以先下载本地蓝图。",
  storage_capacity: "存档空间已满。草图仍在，可以下载本地蓝图。",
  physics_unavailable: "测试场加载失败，请刷新后重试。", unsupported_version: "旧规则蓝图已保留，请重新确认后测试。",
  art_unavailable: "场景素材加载失败，请刷新后重试。",
  multiple_cannons: "这一版支持一座自动炮台。", mixed_attacks: "火炮暂不与刀刃或锤头组合，请分别测试。",
  missing_muzzle: "先设置炮口，再在炮口前方设置朝向。", muzzle_outside_barrel: "炮口需要落在已标注的炮管上。",
  invalid_cannon_direction: "朝向点需要在炮口前方，与炮口拉开一点距离。",
  muzzle_not_forward: "炮口需要位于朝向指向的炮管前端。", invalid_barrel_shape: "炮管需要明显长于宽度，请画一段长炮管。",
  invalid_cannon_design: "炮管参数超出范围，请恢复默认后调整。", cannon_design_mismatch: "炮台参数与几何不一致，请重新载入设计。",
};
const errorText = (error: unknown) => {
  const code = error instanceof SiegeError || error instanceof CompileError ? error.code : "service_unavailable";
  return messages[code] ?? "操作没有完成，画图仍在。请稍后重试。";
};
export interface SiegeWorkshopProps {
  platform: SiegePlatform;
  scope: SiegeScope;
  /**
   * Where the campaign ("林地闯关") lives. Web passes its workspace route;
   * The shared workspace page supplies the campaign destination.
   */
  campaignHref?: string;
}

export function SiegeWorkshop({ platform, scope }: SiegeWorkshopProps) {
  // The transport comes from the platform: /api/siege is workspace-scoped, so
  // the host has to contribute the workspace slug and its own credential.
  const { workspaceId, workspaceSlug, userId } = scope;
  const api = useMemo(() => createSiegeClient({ workspaceId, workspaceSlug, userId }), [workspaceId, workspaceSlug, userId]);
  // The paper texture comes from the host's asset base, which differs between
  // an absolute web URL and a packaged desktop build's relative path.
  const paperStyle = useMemo(
    () => ({ "--siege-paper": `url("${platform.assetUrl("workshop-paper")}")` }) as CSSProperties,
    [platform],
  );
  const [workshopMode, setWorkshopMode] = useState<"cannon" | "drawing">("cannon");
  const [cannonDesign, setCannonDesign] = useState<CannonDesign>(() => ({ ...DEFAULT_CANNON }));
  const [drawing, setDrawing] = useState<Drawing>(() => createCannonDrawing(DEFAULT_CANNON));
  const freehand = useRef<FreehandDraft>({ drawing: structuredClone(SAMPLES[0]!.drawing), spec: sampleSpec(SAMPLES[0]!, placeholderHash), name: SAMPLES[0]!.name });
  const cannonName = useRef("林地守卫炮");
  const [spec, setSpec] = useState<WeaponSpec | null>(null);
  const [hash, setHash] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<CanvasTool>("draw");
  const [width, setWidth] = useState<24 | 40>(24);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [sessionId, setSessionId] = useState(() => platform.preferences.getItem("siege.session") ?? "");
  const [name, setName] = useState("林地守卫炮");
  const [run, setRun] = useState(0);
  const [runningDefinition, setRunningDefinition] = useState<WeaponDefinition | null>(null);
  const [mode, setMode] = useState<ArenaMode>("defense");
  const [paused, setPaused] = useState(false);
  const [collisions, setCollisions] = useState(false);
  const [stats, setStats] = useState(initialStats);
  const [retryRecognition, setRetryRecognition] = useState<{ session: string; request: string; drawing: Drawing } | null>(null);
  const retrySave = useRef<Parameters<SiegeClient["save"]>[1] | null>(null);
  const createRequest = useRef(platform.randomId());
  const currentDrawing = useRef(drawing); currentDrawing.current = drawing;
  const edited = useRef(false);
  const queryClient = useQueryClient();
  const status = useQuery(siegeStatusOptions(api, scope));
  const session = useQuery(siegeSessionOptions(api, scope, sessionId));
  const navigation = useNavigation();
  const requestedBlueprint = navigation.searchParams.get("blueprint") ?? "";
  const blueprintLibrary = useQuery({ ...siegeLibraryOptions(api, scope), enabled: !!requestedBlueprint });
  useEffect(() => {
    let cancelled = false;
    platform.loadDraft().then(draft => {
      if (!cancelled && !edited.current && draft) {
        edited.current = true; freehand.current = draft.freehand; cannonName.current = draft.cannonName;
        setCannonDesign(draft.cannonDesign); setWorkshopMode(draft.mode);
        const next = draft.mode === "cannon" ? createCannonDrawing(draft.cannonDesign) : draft.freehand.drawing;
        currentDrawing.current = next; setDrawing(next); setSpec(draft.mode === "cannon" ? null : draft.freehand.spec);
        setName(draft.mode === "cannon" ? draft.cannonName : draft.freehand.name);
        setMode(draft.mode === "cannon" ? "defense" : "practice");
      }
    }).catch(() => { if (!cancelled) setNotice("浏览器未开放草图存储，可以下载蓝图。"); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [platform]);
  useEffect(() => {
    let cancelled = false;
    platform.drawingHash(drawing).then(value => {
      if (cancelled) return; setHash(value);
      if (workshopMode === "cannon") setSpec(createCannonSpec(drawing, value));
      else setSpec(previous => previous?.drawingHash === placeholderHash ? { ...previous, drawingHash: value } : previous);
    }).catch(() => { if (!cancelled) setError("当前浏览器无法计算草图身份，请使用本机或 HTTPS 地址。"); });
    return () => { cancelled = true; };
  }, [drawing, workshopMode, platform]);
  useEffect(() => {
    if (!loaded) return;
    const timeout = setTimeout(() => {
      platform.saveDraft({ mode: workshopMode, cannonDesign, cannonName: workshopMode === "cannon" ? name : cannonName.current,
        freehand: workshopMode === "drawing" ? { drawing, spec, name } : freehand.current }).catch(() => setNotice("草图存储失败，请下载一份蓝图。"));
    }, 400);
    return () => clearTimeout(timeout);
  }, [drawing, spec, loaded, name, workshopMode, cannonDesign, platform]);
  const latestDraft = useRef<WorkshopDraft | null>(null);
  latestDraft.current = loaded ? { mode: workshopMode, cannonDesign, cannonName: workshopMode === "cannon" ? name : cannonName.current, freehand: workshopMode === "drawing" ? { drawing, spec, name } : freehand.current } : null;
  useEffect(() => () => {
    if (latestDraft.current) void platform.saveDraft(latestDraft.current).catch(() => {});
  }, [platform]);
  const compiled = useMemo(() => {
    if (!spec || !hash) return { definition: null, error: "" };
    try { return { definition: compileWeapon(drawing, spec, hash, workshopMode === "cannon" ? cannonDesign : null), error: "" }; }
    catch (e) { return { definition: null, error: errorText(e) }; }
  }, [drawing, spec, hash, workshopMode, cannonDesign]);
  const designChanged = useMemo(() => !!runningDefinition &&
    (canonicalDrawing(drawing) !== canonicalDrawing(runningDefinition.drawing) || JSON.stringify(spec) !== JSON.stringify(runningDefinition.spec) ||
      JSON.stringify(workshopMode === "cannon" ? cannonDesign : null) !== JSON.stringify(runningDefinition.cannonDesign)),
  [drawing, spec, runningDefinition, workshopMode, cannonDesign]);
  const cannon = spec?.parts.find(p => p.type === "cannon");
  const changeDrawing = (next: Drawing) => {
    edited.current = true; currentDrawing.current = next; setDrawing(next); setSpec(null); setSelected([]); setError(""); setNotice("");
    setTool("draw");
    retrySave.current = null;
  };
  const changeCannon = (next: CannonDesign) => {
    setCannonDesign(next); changeDrawing(createCannonDrawing(next, currentDrawing.current.revision + 1));
  };
  const switchWorkshop = (next: "cannon" | "drawing") => {
    if (next === workshopMode) return;
    if (workshopMode === "drawing") freehand.current = { drawing, spec, name };
    else cannonName.current = name;
    setWorkshopMode(next);
    if (next === "cannon") { changeDrawing(createCannonDrawing(cannonDesign, currentDrawing.current.revision + 1)); setName(cannonName.current); }
    else { changeDrawing(freehand.current.drawing); setSpec(freehand.current.spec); setName(freehand.current.name); }
    if (!run) setMode(next === "cannon" ? "defense" : "practice");
  };
  const restoreBlueprint = (blueprint: Blueprint) => {
    if (workshopMode === "drawing") freehand.current = { drawing, spec, name };
    else cannonName.current = name;
    const kit = blueprint.cannonDesign;
    if (kit && blueprint.rulesVersion === RULES_VERSION && blueprint.spec && matchesCannonDesign(kit, blueprint.drawing, blueprint.spec)) {
      setWorkshopMode("cannon"); setCannonDesign(kit); cannonName.current = blueprint.name;
      changeDrawing(createCannonDrawing(kit, currentDrawing.current.revision + 1));
    } else {
      setWorkshopMode("drawing"); changeDrawing(structuredClone(blueprint.drawing));
      if (blueprint.rulesVersion === RULES_VERSION && blueprint.spec) setSpec(structuredClone(blueprint.spec)); else setError(messages.unsupported_version!);
      if (kit) setError(messages.cannon_design_mismatch!);
    }
    setName(blueprint.name);
  };
  const restoreBlueprintRef = useRef(restoreBlueprint); restoreBlueprintRef.current = restoreBlueprint;
  const restoredRequestedBlueprint = useRef(false);
  useEffect(() => {
    if (restoredRequestedBlueprint.current || !requestedBlueprint || !blueprintLibrary.data) return;
    const blueprint = blueprintLibrary.data.blueprints.find(item => item.id === requestedBlueprint);
    if (!blueprint) return;
    restoredRequestedBlueprint.current = true;
    restoreBlueprintRef.current(blueprint);
  }, [requestedBlueprint, blueprintLibrary.data]);
  const loadSample = async (index: number) => {
    const sample = SAMPLES[index]; if (!sample) return;
    const next = structuredClone(sample.drawing); next.revision = currentDrawing.current.revision + 1;
    changeDrawing(next); setName(sample.name);
    const value = await platform.drawingHash(next);
    if (currentDrawing.current === next) setSpec(sampleSpec(sample, value));
  };
  const assign = (type: PartType) => {
    if (!selected.length || !hash) return;
    const selectedSet = new Set(selected);
    const parts = (spec?.parts ?? []).map(p => ({ ...p, strokeRefs: p.strokeRefs.filter(r => !selectedSet.has(r.strokeId)) })).filter(p => p.strokeRefs.length);
    parts.push({ id: "part-" + platform.randomId(), type, strokeRefs: drawing.strokes.filter(s => selectedSet.has(s.id)).map(s => ({ strokeId: s.id, fromPoint: 0, toPoint: s.points.length - 1 })), anchorHint: null, directionHint: null });
    const assigned = new Set(parts.flatMap(p => p.strokeRefs.map(r => r.strokeId)));
    const unassigned = drawing.strokes.filter(s => !assigned.has(s.id));
    if (unassigned.length) parts.push({ id: "remaining-structure", type: "structure", strokeRefs: unassigned.map(stroke => ({ strokeId: stroke.id, fromPoint: 0, toPoint: stroke.points.length - 1 })), anchorHint: null, directionHint: null });
    const wheel = parts.find(p => p.type === "wheel");
    const wheelPoints = drawing.strokes.filter(s => wheel?.strokeRefs.some(r => r.strokeId === s.id)).flatMap(s => s.points);
    const pivot: Point = spec?.mountHint ?? (wheelPoints.length ? [
      Math.round((Math.min(...wheelPoints.map(p => p[0])) + Math.max(...wheelPoints.map(p => p[0]))) / 2),
      Math.round((Math.min(...wheelPoints.map(p => p[1])) + Math.max(...wheelPoints.map(p => p[1]))) / 2),
    ] : drawing.strokes[0]?.points[0] ?? [2048, 2048]);
    const root = wheel ?? parts[0]!;
    setSpec({ schemaVersion: 1, drawingHash: hash, parts, decorations: [], mountHint: pivot, unresolved: [],
      links: parts.filter(p => p.id !== root.id).map(p => ({ from: root.id, to: p.id, kind: "fixed", anchorHint: null })) });
    setSelected([]); setError(""); setNotice(type === "cannon" ? "火炮已标注，请设置炮口和朝向。" : "部件已确认，可以试着改变转轴。"); retrySave.current = null;
  };
  const place = (placement: Exclude<CanvasTool, "draw">, point: Point) => {
    if (!spec) { setError("先选中笔画，并给它确认一个部件。"); setTool("draw"); return; }
    if (placement === "mount") setSpec({ ...spec, mountHint: point });
    else setSpec({ ...spec, parts: spec.parts.map(part => part.type !== "cannon" ? part : placement === "muzzle"
      ? { ...part, anchorHint: point, directionHint: null } : { ...part, directionHint: point }) });
    retrySave.current = null; setError(""); setNotice(""); setTool(placement === "muzzle" ? "direction" : "draw");
  };
  const ensureSession = async (): Promise<SiegeSession> => {
    if (sessionId) {
      try { const existing = await api.read(sessionId); queryClient.setQueryData(siegeKeys.session(scope, sessionId), existing); return existing; }
      catch (e) { if (!(e instanceof SiegeError) || e.code !== "not_found") throw e; }
    }
    const created = await api.create(createRequest.current);
    platform.preferences.setItem("siege.session", created.id); setSessionId(created.id);
    queryClient.setQueryData(siegeKeys.session(scope, created.id), created); return created;
  };
  const recognition = useMutation({
    mutationFn: async (recover: boolean) => {
      const input = recover && retryRecognition ? retryRecognition : { session: (await ensureSession()).id, request: platform.randomId(), drawing: structuredClone(currentDrawing.current) };
      setRetryRecognition(input);
      const result = recover ? await api.receipt(input.session, input.request) : await api.recognize(input.session, input.request, input.drawing);
      return { result, revision: input.drawing.revision };
    },
    onSuccess: async ({ result, revision }) => {
      const target = currentDrawing.current, latest = await platform.drawingHash(target);
      if (currentDrawing.current !== target || result.drawingHash !== latest || target.revision !== revision) { setNotice("草图已改变，旧识别结果没有覆盖新画图。"); return; }
      if (result.state === "complete" && result.spec) { setSpec(result.spec); setError(""); setNotice("部件已识别。可以手动修正，再去测试。"); setRetryRecognition(null); }
      else setError(messages[result.code] ?? "识别没有完成，请手动标注。");
    },
    onError: e => setError(errorText(e)),
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!spec || !compiled.definition) throw new CompileError("invalid_blueprint");
      const active = await ensureSession();
      const input = retrySave.current ?? { requestId: platform.randomId(), expectedVersion: active.version, name: name.trim() || "我的防线", drawing: structuredClone(drawing), spec: structuredClone(spec), cannonDesign: workshopMode === "cannon" ? structuredClone(cannonDesign) : null };
      retrySave.current = input; return api.save(active.id, input);
    },
    onSuccess: value => {
      queryClient.setQueryData(siegeKeys.session(scope, value.id), value); retrySave.current = null;
      setError(""); setNotice("蓝图已保存。");
    },
    onError: e => {
      if (e instanceof SiegeError && e.code === "version_conflict") { retrySave.current = null; void queryClient.invalidateQueries({ queryKey: siegeKeys.session(scope, sessionId) }); }
      setError(errorText(e));
    },
  });
  const start = () => {
    if (!compiled.definition) return;
    setRunningDefinition(structuredClone(compiled.definition)); setRun(n => n + 1); setStats(initialStats()); setPaused(false); setError("");
  };
  const exportDrawing = () => platform.exportImage(drawing, workshopMode === "cannon" ? cannonDesign : null, "siege-design.png");
  const busy = recognition.isPending || save.isPending;
  return <main className="siege-app" style={paperStyle} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setPaused(true);
  }}>
    <div className="game-header"><span className="eyebrow">DOODLE SIEGE / WORKSHOP</span><Button variant="outline" size="sm" onClick={exportDrawing}><Download />下载原画</Button></div>
    <section className="game-intro"><div><span className="eyebrow">THE DRAWING WORKSHOP</span><h1>画出你的<br /><em>制胜一笔。</em></h1></div>
      <div className="intro-note"><span className="note-arrow">↳</span><p>长一点，够得更远。<br />重一点，也会转得更慢。</p><span className="stamp">画 · 试 · 再画</span></div></section>
    <div className="workshop">
      <section className="editor-panel" aria-labelledby="drawing-title"><div className="panel-heading"><div><span className="step-number">01</span><h2 id="drawing-title">武器工坊</h2></div>
        {workshopMode === "drawing" && <div className="tools"><Button variant={tool === "draw" ? "brand" : "ghost"} size="icon-sm" aria-label="画笔" aria-pressed={tool === "draw"} onClick={() => setTool("draw")}><Pencil /></Button>
          <Button variant={tool === "mount" ? "brand" : "ghost"} size="icon-sm" aria-label="设置转轴" aria-pressed={tool === "mount"} onClick={() => setTool("mount")}><Crosshair /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="撤销上一笔" disabled={!drawing.strokes.length} onClick={() => changeDrawing({ ...drawing, revision: drawing.revision + 1, strokes: drawing.strokes.slice(0, -1) })}><Undo2 /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="新画布" onClick={() => { changeDrawing({ ...emptyDrawing(), revision: drawing.revision + 1 }); setTool("draw"); }}><Eraser /></Button></div>}</div>
        <div className="workshop-modes" role="group" aria-label="工坊模式">
          <Button size="sm" variant={workshopMode === "cannon" ? "brand" : "ghost"} aria-pressed={workshopMode === "cannon"} onClick={() => switchWorkshop("cannon")}>精制炮台</Button>
          <Button size="sm" variant={workshopMode === "drawing" ? "brand" : "ghost"} aria-pressed={workshopMode === "drawing"} onClick={() => switchWorkshop("drawing")}>自由绘图</Button>
        </div>
        {workshopMode === "cannon" ? <CannonWorkshop design={cannonDesign} onChange={changeCannon} /> : <>
          {cannon && <div className="cannon-controls">
            <Button size="xs" variant={tool === "muzzle" ? "brand" : "outline"} aria-pressed={tool === "muzzle"} onClick={() => setTool(tool === "muzzle" ? "draw" : "muzzle")}>设置炮口</Button>
            <Button size="xs" variant={tool === "direction" ? "brand" : "outline"} aria-pressed={tool === "direction"} disabled={!cannon.anchorHint} onClick={() => setTool(tool === "direction" ? "draw" : "direction")}>设置朝向</Button>
            {(tool === "muzzle" || tool === "direction" || !cannon.anchorHint || !cannon.directionHint) && <p role="status">{tool === "direction" ? "点击炮口前方，确定发射朝向。" : "点击炮管前端设置炮口，再设置朝向。"}</p>}
          </div>}
        <div className="drawing-paper"><DrawingCanvas randomId={platform.randomId} drawing={drawing} spec={spec} selected={selected} width={width} tool={tool} onChange={changeDrawing}
          onPlacement={place} />
          {!drawing.strokes.length && <div className="canvas-empty" aria-hidden="true"><span>从一笔开始</span><p>画一个锤头、刀刃、炮管或盾</p></div>}
          <span className="paper-corner">8 × 8 m</span></div>
        <div className="brush-row"><label htmlFor="brush-width">笔宽</label><select id="brush-width" value={width} onChange={e => setWidth(e.target.value === "40" ? 40 : 24)}><option value="24">细笔</option><option value="40">粗笔</option></select>
          <span>{drawing.strokes.length} 笔</span>{SAMPLES.map((sample, i) => <Button key={sample.id} variant="ghost" size="xs" onClick={() => void loadSample(i)}>{sample.name}</Button>)}</div>
        <div className="recognition-row"><Button disabled={!drawing.strokes.length || !status.data?.ready || busy} onClick={() => recognition.mutate(false)} aria-busy={recognition.isPending}>
          {recognition.isPending ? <LoaderCircle className="spin" /> : <Sparkles />}AI 识别</Button>
          <span className="mode-note">{status.data?.mode === "fixture" ? "样例识别模式 · 自由绘图请手动标注" : status.data?.ready ? "识别后可修正" : "AI 未连接 · 可手动标注"}</span></div>
        <div className="part-editor"><div className="part-heading"><h3>确认部件</h3><span>选中笔画，再组合成部件</span></div>
          <div className="stroke-list">{drawing.strokes.map((stroke, i) => <button key={stroke.id} type="button" className={"stroke-chip " + (selected.includes(stroke.id) ? "selected" : "")}
            aria-pressed={selected.includes(stroke.id)} onClick={() => setSelected(list => list.includes(stroke.id) ? list.filter(id => id !== stroke.id) : [...list, stroke.id])}>
            <span>{selected.includes(stroke.id) ? <Check size={12} /> : i + 1}</span>{spec?.parts.find(p => p.strokeRefs.some(r => r.strokeId === stroke.id)) ? labels[spec.parts.find(p => p.strokeRefs.some(r => r.strokeId === stroke.id))!.type] : "未标注"}</button>)}</div>
          <div className="part-buttons">{(Object.keys(labels) as PartType[]).map(type => <Button key={type} variant="outline" size="xs" disabled={!selected.length} onClick={() => assign(type)}>{labels[type]}</Button>)}</div>
          {spec?.unresolved.map((question, i) => <p key={i} className="question">{question}</p>)}
          {!!spec?.unresolved.length && <Button size="xs" variant="outline" onClick={() => setSpec({ ...spec, unresolved: [] })}>按当前部件确认</Button>}
        </div>
        </>}
        <DesignMetrics definition={compiled.definition} spec={spec} comparison={workshopMode === "cannon" ? defaultDefinition : null} />
        {compiled.error && <p className="compile-error" role="status">{compiled.error}</p>}
        <div className="save-row"><label className="sr-only" htmlFor="weapon-name">蓝图名称</label><input id="weapon-name" value={name} maxLength={80} onChange={e => { edited.current = true; setName(e.target.value); retrySave.current = null; }} />
          <Button variant="outline" disabled={!compiled.definition || busy} onClick={() => save.mutate()} aria-busy={save.isPending}>{save.isPending ? <LoaderCircle className="spin" /> : <Save />}保存蓝图</Button>
          <Button variant="ghost" size="icon" aria-label="下载蓝图" disabled={!spec} onClick={() => platform.download(new Blob([JSON.stringify({ drawing, spec, cannonDesign: workshopMode === "cannon" ? cannonDesign : null, rulesVersion: RULES_VERSION }, null, 2)], { type: "application/json" }), "siege-blueprint.json")}><Download /></Button></div>
        {session.data?.blueprints.length ? <div className="blueprint-list"><h3>我的蓝图</h3>{session.data.blueprints.map(blueprint => <Button key={blueprint.id} size="xs" variant="outline" onClick={() => {
          restoreBlueprint(blueprint);
        }}>{blueprint.name}</Button>)}</div> : null}
      </section>
      <section className="arena-panel" aria-labelledby="arena-title"><div className="panel-heading"><div><span className="step-number">02</span><h2 id="arena-title">让设计上场</h2></div>
        <span className="arena-tag">{mode === "practice" ? "TEST ARENA" : "CASTLE DEFENSE"}</span></div>
        <div className="arena-paper"><Arena definition={runningDefinition} run={run} mode={mode} paused={paused} onPause={() => setPaused(true)} collisions={collisions} onStats={setStats} onError={code => setError(messages[code] ?? code)} assetUrl={platform.assetUrl} />
          {!run && <div className="arena-empty"><Crosshair /><span>你的第一道防线，<br />即将在这里动起来。</span></div>}</div>
        <div className="arena-actions"><Button size="lg" disabled={!compiled.definition} onClick={start}><Play />{mode === "defense" ? run ? "重新守城" : "开始守城" : run ? "重新测试" : "开始测试"}<ArrowRight /></Button>
          <Button variant="outline" disabled={!run || stats.phase === "finished"} onClick={() => setPaused(value => !value)}>{paused ? <Play /> : <Pause />}{paused ? "继续" : "暂停"}</Button>
          <label className="collision-toggle"><input type="checkbox" checked={collisions} onChange={e => setCollisions(e.target.checked)} />显示碰撞范围</label></div>
        <div className="battle-mode"><Button variant={mode === "practice" ? "brand" : "ghost"} size="sm" onClick={() => { setMode("practice"); setRun(0); setRunningDefinition(null); setStats(initialStats()); }}>测试场</Button>
          <Button variant={mode === "defense" ? "brand" : "ghost"} size="sm" onClick={() => { setMode("defense"); setRun(0); setRunningDefinition(null); setStats(initialStats()); }}>三波守城试玩</Button></div>
        <BattleMetrics definition={runningDefinition} stats={stats} mode={mode} paused={paused} changed={designChanged} error={compiled.error} />

      </section>
    </div>
    {(error || notice) && <div className={"message-bar " + (error ? "error" : "")} role={error ? "alert" : "status"}>{error || notice}
      {retryRecognition && <Button variant="outline" size="xs" disabled={recognition.isPending} onClick={() => recognition.mutate(true)}>恢复识别结果</Button>}
      {error && <Button variant="ghost" size="icon-xs" aria-label="关闭提示" onClick={() => setError("")}><RotateCcw /></Button>}</div>}
    <footer className="game-footer"><span>DOODLE SIEGE — EXPERIMENT 001</span><span>形状决定功能。下一笔，也许就不一样。</span></footer>
  </main>;
}
