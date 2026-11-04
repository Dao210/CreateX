"use client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@auro/core/api";
import { useQuery } from "@tanstack/react-query";
import { Fish, Waves, RotateCcw, Pause, Play, Maximize, Minimize, Crosshair, Copy } from "lucide-react";
import { useAuthStore } from "@auro/core/auth";
import { useCurrentWorkspace, useWorkspacePaths } from "@auro/core/paths";
import { FISH_EXAMPLES, myFishOptions, fishOceanOptions, useFishActions, type FishCharacter, type FishSpec, type FishResident } from "@auro/core/fish";
import type { StorageAdapter } from "@auro/core/types";
import { Button } from "@auro/ui/components/ui/button";
import { GameAccessBoundary } from "../admin/game-access-boundary";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { FishConnection } from "./fish-connection";
import { FishEditor, previewResident } from "./fish-editor";
import { FishThumbnail } from "./fish-thumbnail";
const Scene = lazy(() => import("./fish-scene"));
const EMPTY_RESIDENTS: FishResident[] = [];
export function FishPage({ storage }: { storage: StorageAdapter }) {
 const workspace = useCurrentWorkspace(), userId = useAuthStore(s => s.user?.id);
 if (!workspace || !userId) return null;
 return <GameAccessBoundary gameId="fish"><OceanContent key={`${workspace.id}:${userId}`} storage={storage} workspace={workspace} userId={userId} /></GameAccessBoundary>;
}
function OceanContent({ storage, workspace, userId }: { storage: StorageAdapter; workspace: { id: string; slug: string; name: string }; userId: string }) {
 const { t } = useT("fish"), navigation = useNavigation(), paths = useWorkspacePaths();
 const oceanId = navigation.searchParams.get("ocean") ?? "", focused = navigation.searchParams.get("resident") ?? "", previewId = navigation.searchParams.get("fish") ?? "";
 const oceanQuery = useQuery(fishOceanOptions(workspace.id, userId, oceanId)), fishQuery = useQuery(myFishOptions(workspace.id, userId));
 const requestedRevision = Number(navigation.searchParams.get("revision") ?? 0);
 const previewQuery = useQuery({ queryKey: ["fish", workspace.id, userId, "preview", previewId, requestedRevision], queryFn: () => api.getFish(workspace.id, previewId, requestedRevision), enabled: !!previewId, retry: false });
 const actions = useFishActions(workspace.id), root = useRef<HTMLDivElement>(null), retry = useRef<(() => Promise<void>) | null>(null);
 const [busy, setBusy] = useState(false), [error, setError] = useState(false), [selectedId, setSelectedId] = useState(focused), [follow, setFollow] = useState(false), [paused, setPaused] = useState(false), [reset, setReset] = useState(0), [fullscreen, setFullscreen] = useState(false), [showArchived, setShowArchived] = useState(false), [sharing, setSharing] = useState(false), [copied, setCopied] = useState(false);
 const preferenceKey = `fish:${workspace.id}:${userId}:quality`, [lowQuality, setLowQuality] = useState(() => storage.getItem(preferenceKey) === "low");
 const ocean = oceanQuery.data, ownOcean = !ocean || ocean.ownerId === userId, creations = fishQuery.data ?? [];
 const residents = ocean?.residents ?? EMPTY_RESIDENTS;
 const demos = useMemo(() => FISH_EXAMPLES.map((spec, i) => ({ ...previewResident(spec), id: `demo-${i}`, seed: i * 793 + 1 })), []);
 const showingDemo = !residents.length && ownOcean && !oceanQuery.isError;

 const selected = residents.find(r => r.id === selectedId), selectedFish = selected ? creations.find(f => f.id === selected.fish.id) : previewQuery.data;
 const selectedSpec = selected?.fish ?? selectedFish;
 const previewResidents = useMemo(() => previewQuery.data ? [previewResident(previewQuery.data.draft)] : [], [previewQuery.data]);
 const previewing = !!previewId && !!previewQuery.data;
 const visibleResidents = previewing ? previewResidents : showingDemo ? demos : residents;
 const run = useCallback(async (command: () => Promise<void>) => {
  if (busy) return false; setBusy(true); setError(false); retry.current = command;
  try { await command(); retry.current = null; return true; } catch { setError(true); return false; } finally { setBusy(false); }
 }, [busy]);
 useEffect(() => { setSelectedId(focused); }, [focused]);
 useEffect(() => { const changed = () => { const active = document.fullscreenElement === root.current; setFullscreen(active); if (!active) setPaused(true); }; document.addEventListener("fullscreenchange", changed); return () => document.removeEventListener("fullscreenchange", changed); }, []);
 const select = (id: string) => {
  setSelectedId(id); if (id.startsWith("demo-")) return;
  const params = new URLSearchParams(navigation.searchParams); params.set("resident", id); if (ocean) params.set("ocean", ocean.id); params.delete("fish"); navigation.replace(`${paths.fish()}?${params}`);
 };
 const save = async (draft: FishSpec, character?: FishCharacter) => {
  const requestId = crypto.randomUUID();
  return run(async () => { const result = await actions.save.mutateAsync({ requestId, draft, ...(character ? { fishId: character.id, expectedRevision: character.revision } : {}) }); const params = new URLSearchParams(navigation.searchParams); params.set("fish", result.id); params.delete("resident"); navigation.replace(`${paths.fish()}?${params}`); setSelectedId(""); });
 };
 const ensure = async (requestId: string) => ocean && ownOcean ? ocean : actions.createOcean.mutateAsync(requestId);
 const release = (fish: FishCharacter) => {
  const oceanRequestId = crypto.randomUUID(), requestId = crypto.randomUUID();
  void run(async () => { const target = await ensure(oceanRequestId); const result = await actions.release.mutateAsync({ requestId, oceanId: target.id, fishId: fish.id, revision: fish.revision, contentHash: fish.contentHash }); navigation.replace(`${paths.fish()}?ocean=${encodeURIComponent(target.id)}&resident=${encodeURIComponent(result.resident.id)}`); setSelectedId(result.resident.id); });
 };
 const recall = (resident: FishResident) => { const requestId = crypto.randomUUID(); void run(async () => { await actions.recall.mutateAsync({ requestId, residentId: resident.id, expectedResidentRevision: resident.revision }); setSelectedId(""); const params = new URLSearchParams(navigation.searchParams); params.delete("resident"); navigation.replace(`${paths.fish()}${params.size ? `?${params}` : ""}`); }); };
 const changeVisibility = (visibility: "private" | "world") => { if (!ocean) return; const requestId = crypto.randomUUID(); void run(async () => { await actions.settings.mutateAsync({ requestId, oceanId: ocean.id, expectedRevision: ocean.revision, visibility }); }); };
 return <div className="fish-page" ref={root}>
  <header className="fish-header"><div className="fish-brand"><Waves aria-hidden /><div><h1>{t($ => $.title)}</h1><p>{workspace.name}</p></div></div><div className="fish-header-actions">{!ownOcean && <Button variant="outline" size="sm" onClick={() => navigation.replace(paths.fish())}>{t($ => $.back)}</Button>}<FishConnection workspace={workspace} userId={userId} />{ownOcean && <FishEditor onSave={save} pending={busy} />}</div></header>
  {error && <div className="fish-action-error" role="alert"><span>{t($ => $.error)}</span><Button size="xs" variant="outline" disabled={busy} onClick={() => { if (retry.current) void run(retry.current); }}>{t($ => $.retry)}</Button></div>}
  <section className="fish-stage" aria-label={t($ => $.title)}>
   {oceanQuery.isError ? <div className="fish-state" role="alert"><p>{t($ => $.error)}</p><Button variant="outline" onClick={() => void oceanQuery.refetch()}>{t($ => $.retry)}</Button></div> : oceanQuery.isPending ? <div className="fish-state" role="status">{t($ => $.loading)}</div> : <Suspense fallback={<div className="fish-state" role="status">{t($ => $.loading)}</div>}><Scene residents={visibleResidents} preview={previewing} selectedId={previewing ? "preview" : selectedId} onSelect={select} follow={follow} reset={reset} paused={paused} lowQuality={lowQuality} /></Suspense>}
   {!oceanQuery.isError && <><div className="fish-scene-heading"><span className="fish-eyebrow">{ownOcean ? t($ => $.back) : t($ => $.visiting)}</span><h2>{t($ => $.subtitle)}</h2><span className="fish-count">{t($ => $.capacity, { count: residents.length, capacity: ocean?.capacity ?? 50 })}</span></div>
   {showingDemo && !previewing && <div className="fish-demo-label">{t($ => $.demo)}</div>}
   <div className="fish-tools"><Button variant="ghost" size="icon-sm" aria-label={t($ => $.reset)} onClick={() => { setReset(v => v + 1); setFollow(false); }}><RotateCcw /></Button><Button variant="ghost" size="icon-sm" aria-label={paused ? t($ => $.resume) : t($ => $.pause)} aria-pressed={paused} onClick={() => setPaused(v => !v)}>{paused ? <Play /> : <Pause />}</Button><Button variant={lowQuality ? "brandSubtle" : "ghost"} size="sm" aria-pressed={lowQuality} onClick={() => { setLowQuality(v => !v); storage.setItem(preferenceKey, lowQuality ? "high" : "low"); }}>{t($ => $.low_quality)}</Button><Button variant="ghost" size="icon-sm" aria-label={fullscreen ? t($ => $.exit_fullscreen) : t($ => $.fullscreen)} onClick={async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); } catch { setError(true); } }}>{fullscreen ? <Minimize /> : <Maximize />}</Button></div>
   {selectedSpec && <aside className="fish-selected"><FishThumbnail spec={selectedSpec.draft} /><div><h3>{selectedSpec.draft.name}</h3><p>{t($ => $.revision, { revision: selected?.fish.revision ?? selectedSpec.revision })}</p></div>{selected && <Button variant={follow ? "brand" : "outline"} size="icon-sm" aria-label={follow ? t($ => $.stop_follow) : t($ => $.follow)} aria-pressed={follow} onClick={() => setFollow(v => !v)}><Crosshair /></Button>}{ownOcean && selected && <Button variant="outline" size="sm" disabled={busy} onClick={() => recall(selected)}>{t($ => $.recall)}</Button>}</aside>}</>}
  </section>
  <section className="fish-library"><div className="fish-library-heading"><div><span className="fish-eyebrow">{t($ => $.my_fish)}</span><h2>{creations.length ? t($ => $.my_fish) : t($ => $.empty)}</h2></div><div className="fish-header-actions"><label className="fish-check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />{t($ => $.show_archived)}</label>{ocean && ownOcean && <Button variant="outline" size="sm" onClick={() => setSharing(v => !v)}>{t($ => $.share)}</Button>}</div></div>
   {sharing && ocean && ownOcean && <div className="fish-sharing"><label>{t($ => $.visibility)}<select value={ocean.visibility} disabled={busy} onChange={e => changeVisibility(e.target.value === "world" ? "world" : "private")}><option value="private">{t($ => $.private)}</option><option value="world">{t($ => $.world)}</option></select></label>{ocean.visibility === "world" && <><p>{t($ => $.share_help)}</p><Button variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(navigation.getShareableUrl(`${paths.fish()}?ocean=${encodeURIComponent(ocean.id)}`)); setCopied(true); } catch { setError(true); } }}><Copy />{copied ? t($ => $.copied) : t($ => $.share)}</Button></>}</div>}
   {previewQuery.isError && <p role="alert">{t($ => $.invalid)}</p>}
   {fishQuery.isError && <p role="alert">{t($ => $.error)} <Button variant="outline" size="xs" onClick={() => void fishQuery.refetch()}>{t($ => $.retry)}</Button></p>}
   <div className="fish-grid">{creations.filter(f => showArchived || !f.archived).map(fish => { const resident = residents.find(r => r.fish.id === fish.id); return <article className="fish-card" key={fish.id} data-selected={selectedFish?.id === fish.id}><button className="fish-card-preview" aria-label={`${t($ => $.select_fish)}: ${fish.draft.name}`} onClick={() => { if (resident) select(resident.id); else navigation.replace(`${paths.fish()}?fish=${encodeURIComponent(fish.id)}`); }}><FishThumbnail spec={fish.draft} /></button><div className="fish-card-heading"><h3>{fish.draft.name}</h3><span>{t($ => $.revision, { revision: fish.revision })}</span></div><p>{fish.archived ? t($ => $.archived) : resident ? t($ => $.in_ocean) : t($ => $.not_released)}{fish.origin === "mcp" && <Fish size={12} aria-label={t($ => $.creation_origin)} />}</p><div className="fish-card-actions">{!fish.archived && <FishEditor character={fish} onSave={save} pending={busy} />}{!fish.archived && ownOcean && !resident && <Button size="sm" disabled={busy} onClick={() => release(fish)}>{t($ => $.release)}</Button>}{resident && ownOcean && resident.fish.revision !== fish.revision && <Button size="sm" disabled={busy} onClick={() => { const requestId = crypto.randomUUID(); void run(async () => { await actions.apply.mutateAsync({ requestId, residentId: resident.id, expectedResidentRevision: resident.revision, oceanId: resident.oceanId, fishId: fish.id, revision: fish.revision, contentHash: fish.contentHash }); }); }}>{t($ => $.apply)}</Button>}<Button size="xs" variant="ghost" disabled={busy} onClick={() => { const requestId = crypto.randomUUID(); void run(async () => { await actions.archive.mutateAsync({ requestId, fishId: fish.id, archived: !fish.archived }); }); }}>{fish.archived ? t($ => $.restore) : t($ => $.archive)}</Button></div></article>; })}</div>
   {!creations.length && !fishQuery.isPending && !fishQuery.isError && <p className="fish-empty-note">{t($ => $.ocean_empty)}</p>}
  </section>
 </div>;
}
