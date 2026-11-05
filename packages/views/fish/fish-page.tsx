"use client";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@auro/core/api";
import { useQuery } from "@tanstack/react-query";
import { Copy, Crosshair, Maximize, Minimize, Pause, Play, RotateCcw, Waves, X } from "lucide-react";
import { useAuthStore } from "@auro/core/auth";
import { useCurrentWorkspace, useWorkspacePaths } from "@auro/core/paths";
import { FISH_EXAMPLES, fishOceanOptions, publicFishOceanOptions, useFishActions, type FishCharacter, type FishResident, type FishSpec, type PublicFishResident } from "@auro/core/fish";
import type { StorageAdapter } from "@auro/core/types";
import { Button, buttonVariants } from "@auro/ui/components/ui/button";
import { GameAccessBoundary } from "../admin/game-access-boundary";
import { AppLink, useNavigation } from "../navigation";
import { useT } from "../i18n";
import { FishConnection } from "./fish-connection";
import { FishEditor, previewResident } from "./fish-editor";
import { FishThumbnail } from "./fish-thumbnail";

const Scene = lazy(() => import("./fish-scene"));
const EMPTY_RESIDENTS: FishResident[] = [];
const EMPTY_PUBLIC_RESIDENTS: PublicFishResident[] = [];
const nativeFish = FISH_EXAMPLES.map((spec, i) => ({
  ...previewResident({
    ...spec,
    body: { ...spec.body, lengthMm: Math.max(180, Math.round(spec.body.lengthMm * 0.4)) },
    appearance: { ...spec.appearance, glow: 0, body: ["#7caaaa", "#b3a582", "#729d9e", "#a5beb5", "#ad9e8d", "#91a99b"][i]! },
    motion: { ...spec.motion, speed: Math.round(spec.motion.speed * 0.7) },
  }),
  id: `native-${i}`, seed: i * 793 + 1,
}));

export function FishPage({ storage }: { storage: StorageAdapter }) {
  const workspace = useCurrentWorkspace();
  const userId = useAuthStore(s => s.user?.id);
  if (!workspace || !userId) return null;
  return <GameAccessBoundary gameId="fish">
    <OceanContent key={`${workspace.id}:${userId}`} storage={storage} workspace={workspace} userId={userId} />
  </GameAccessBoundary>;
}

function OceanContent({ storage, workspace, userId }: { storage: StorageAdapter; workspace: { id: string; slug: string; name: string }; userId: string }) {
  const { t } = useT("fish");
  const navigation = useNavigation(), paths = useWorkspacePaths();
  const oceanId = navigation.searchParams.get("ocean") ?? "";
  const residentId = navigation.searchParams.get("resident") ?? "";
  const fishId = navigation.searchParams.get("fish") ?? "";
  const requestedRevision = Number(navigation.searchParams.get("revision") ?? 0);
  const shared = !oceanId;
  const cursor = navigation.searchParams.get("cursor") ?? "";

  const oceanQuery = useQuery({ ...fishOceanOptions(workspace.id, userId, oceanId), enabled: !shared || !!fishId });
  const legacySelected = !shared ? oceanQuery.data?.residents.find(resident => resident.id === residentId || resident.fish.id === fishId) : undefined;
  const publicQuery = useQuery({
    ...publicFishOceanOptions(workspace.id, userId, {
      cursor: cursor || undefined,
      residentId: shared ? residentId || undefined : undefined,
      fishId: shared ? residentId ? undefined : fishId || undefined : legacySelected?.fish.id,
    }),
    enabled: shared || !!legacySelected,
  });
  const activeQuery = shared ? publicQuery : oceanQuery;
  const published = publicQuery.data?.residents ?? EMPTY_PUBLIC_RESIDENTS;
  const focusedPublic = publicQuery.data?.focus;
  const publicResidents = useMemo(() => focusedPublic && !published.some(resident => resident.id === focusedPublic.id)
    ? [...published, focusedPublic] : published, [published, focusedPublic]);
  const residents = shared ? publicResidents : oceanQuery.data?.residents ?? EMPTY_RESIDENTS;
  const ownLegacyOcean = !shared && oceanQuery.data?.ownerId === userId;

  const residentForFish = residents.find(resident => resident.fish.id === fishId);
  const selected = residents.find(resident => resident.id === residentId) ?? residentForFish;
  const previewQuery = useQuery({
    queryKey: ["fish", workspace.id, userId, "preview", fishId, requestedRevision],
    queryFn: () => api.getFish(workspace.id, fishId, requestedRevision),
    enabled: !!fishId,
    retry: false,
  });
  const legacyResident = shared ? oceanQuery.data?.residents.find(resident => resident.fish.id === fishId) : undefined;
  const legacyPreview = !selected && !requestedRevision ? legacyResident?.fish : undefined;
  const draft = legacyPreview ?? previewQuery.data;
  const showDraft = !!draft && (!selected || (!!requestedRevision && selected.fish.revision !== requestedRevision));
  const selectedFish = showDraft ? draft : selected?.fish;
  const draftResident = useMemo(() => showDraft && draft ? previewResident(draft.draft) : null, [showDraft, draft]);
  const visibleResidents = useMemo(() => {
    const room = 50 - residents.length - Number(!!draftResident);
    return [
      ...residents,
      ...(shared ? nativeFish.slice(0, Math.max(0, room)) : []),
      ...(draftResident ? [draftResident] : []),
    ];
  }, [residents, shared, draftResident]);

  const actions = useFishActions(workspace.id);
  const root = useRef<HTMLDivElement>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [follow, setFollow] = useState(false), [paused, setPaused] = useState(false);
  const [reset, setReset] = useState(0), [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const preferenceKey = `fish:${workspace.id}:${userId}:quality`;
  const [lowQuality, setLowQuality] = useState(() => storage.getItem(preferenceKey) === "low");

  useEffect(() => {
    const changed = () => {
      const active = document.fullscreenElement === root.current;
      setFullscreen(active);
      if (!active) setPaused(true);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  function navigate(selection?: { fish: string } | { resident: string }, targetOcean = oceanId) {
    const params = new URLSearchParams(selection);
    if (targetOcean) params.set("ocean", targetOcean);
    setFollow(false);
    navigation.replace(`${paths.fish()}${params.size ? `?${params}` : ""}`);
  }

  async function run(command: () => Promise<void>) {
    if (busy) return false;
    setBusy(true);
    setError(false);
    retry.current = command;
    try {
      await command();
      retry.current = null;
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save = (draft: FishSpec) => {
    const requestId = crypto.randomUUID();
    return run(async () => {
      const result = await actions.save.mutateAsync({ requestId, draft });
      navigate({ fish: result.id }, "");
    });
  };

  function release(fish: FishCharacter) {
    const requestId = crypto.randomUUID();
    void run(async () => {
      const { resident } = await actions.release.mutateAsync({
        requestId, destination: "public", fishId: fish.id, revision: fish.revision, contentHash: fish.contentHash,
      });
      navigate({ resident: resident.id }, "");
    });
  }

  function recall(resident: FishResident | PublicFishResident) {
    const requestId = crypto.randomUUID();
    void run(async () => {
      await actions.recall.mutateAsync({ requestId, residentId: resident.id, expectedResidentRevision: resident.revision, ...(shared ? { destination: "public" as const } : {}) });
      navigate();
    });
  }

  function apply(resident: FishResident | PublicFishResident, fish: FishCharacter) {
    const requestId = crypto.randomUUID();
    void run(async () => {
      await actions.apply.mutateAsync({
        requestId, residentId: resident.id, expectedResidentRevision: resident.revision,
        oceanId: resident.oceanId, fishId: fish.id, revision: fish.revision, contentHash: fish.contentHash,
      });
      navigate({ resident: resident.id });
    });
  }

  function changeVisibility(visibility: "private" | "world") {
    const ocean = oceanQuery.data;
    if (!ocean || !ownLegacyOcean) return;
    const requestId = crypto.randomUUID();
    void run(async () => {
      await actions.settings.mutateAsync({ requestId, oceanId: ocean.id, expectedRevision: ocean.revision, visibility });
      setCopied(false);
    });
  }

  const sceneTitle = shared ? t($ => $.trench) : ownLegacyOcean ? t($ => $.legacy_ocean) : t($ => $.visiting);
  const selectedOwn = selected?.fish.ownerId === userId && (!shared || ("canManage" in selected && selected.canManage));
  const releaseCandidate = shared ? !selected ? draft : undefined : ownLegacyOcean ? legacySelected?.fish : undefined;
  const canRelease = releaseCandidate && releaseCandidate.ownerId === userId && !releaseCandidate.archived && !previewQuery.data?.archived && !publicQuery.data?.focus;
  const canApply = selected && selectedOwn && draft && !draft.archived && selected.fish.revision !== draft.revision;
  const selectionMissing = !activeQuery.isPending && !activeQuery.isError && ((fishId && previewQuery.isError && !selectedFish) || (residentId && !selected));

  return <div className="fish-page" ref={root}>
    <header className="fish-header">
      <div className="fish-brand"><Waves aria-hidden /><h1>{t($ => $.title)}</h1></div>
      <div className="fish-header-actions">
        {!shared && <AppLink href={paths.fish()} className={buttonVariants({ variant: "outline", size: "sm" })}>{t($ => $.trench)}</AppLink>}
        <AppLink href={`${paths.me()}?filter=fish`} className={buttonVariants({ variant: "outline", size: "sm" })}>{t($ => $.creations)}</AppLink>
        <FishConnection workspace={workspace} userId={userId} />
        {shared && <FishEditor onSave={save} pending={busy} />}
      </div>
    </header>
    {error && <div className="fish-action-error" role="alert">
      <span>{t($ => $.error)}</span>
      <Button variant="outline" size="xs" onClick={() => { if (retry.current) void run(retry.current); }}>{t($ => $.retry)}</Button>
    </div>}
    {ownLegacyOcean && <div className="fish-sharing">
      <label>{t($ => $.visibility)} <select value={oceanQuery.data?.visibility} disabled={busy} onChange={event => changeVisibility(event.target.value === "world" ? "world" : "private")}>
        <option value="private">{t($ => $.private)}</option><option value="world">{t($ => $.world)}</option>
      </select></label>
      {oceanQuery.data?.visibility === "world" && <Button size="sm" variant="outline" onClick={() => void run(async () => {
        await navigator.clipboard.writeText(navigation.getShareableUrl(`${paths.fish()}?ocean=${encodeURIComponent(oceanId)}`));
        setCopied(true);
      })}><Copy />{copied ? t($ => $.copied) : t($ => $.share)}</Button>}
    </div>}
    <section className="fish-stage" aria-label={sceneTitle}>
      {activeQuery.isError ? <div className="fish-state" role="alert">
        <p>{t($ => $.load_failed)}</p>
        <Button variant="outline" onClick={() => void activeQuery.refetch()}>{t($ => $.retry)}</Button>
      </div> : activeQuery.isPending ? <div className="fish-state" role="status">{t($ => $.loading)}</div> :
        <Suspense fallback={<div className="fish-state" role="status">{t($ => $.loading)}</div>}>
          <Scene residents={visibleResidents} selectedId={draftResident?.id ?? selected?.id}
            onSelect={id => { if (residents.some(resident => resident.id === id)) navigate({ resident: id }); }}
            follow={follow} reset={reset} paused={paused} lowQuality={lowQuality} />
        </Suspense>}
      {!activeQuery.isError && <>
        <div className="fish-scene-heading">
          <span className="fish-eyebrow">{shared ? t($ => $.shared_water) : workspace.name}</span>
          <h2>{sceneTitle}</h2>
          {!activeQuery.isPending && <span className="fish-count">{shared
            ? `${t($ => $.member_fish, { count: publicQuery.data?.total ?? 0 })} · ${t($ => $.native_school)}`
            : t($ => $.capacity, { count: residents.length, capacity: oceanQuery.data?.capacity ?? 50 })}</span>}
        </div>
        <div className="fish-tools">
          <Button variant="ghost" size="icon-sm" aria-label={t($ => $.reset)} onClick={() => { setReset(v => v + 1); setFollow(false); }}><RotateCcw /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={paused ? t($ => $.resume) : t($ => $.pause)} aria-pressed={paused} onClick={() => setPaused(v => !v)}>{paused ? <Play /> : <Pause />}</Button>
          <Button variant={lowQuality ? "brandSubtle" : "ghost"} size="sm" aria-pressed={lowQuality} onClick={() => { setLowQuality(v => !v); storage.setItem(preferenceKey, lowQuality ? "high" : "low"); }}>{t($ => $.low_quality)}</Button>
          <Button variant="ghost" size="icon-sm" aria-label={fullscreen ? t($ => $.exit_fullscreen) : t($ => $.fullscreen)} onClick={async () => {
            try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
            catch { setError(true); }
          }}>{fullscreen ? <Minimize /> : <Maximize />}</Button>
        </div>
        {selectedFish && <aside className="fish-selected" aria-label={selectedFish.draft.name}>
          <FishThumbnail spec={selectedFish.draft} />
          <div className="fish-selected-info"><h3>{selectedFish.draft.name}</h3><p>{showDraft
            ? t($ => legacyPreview ? $.previous_ocean : $.preview_only)
            : t($ => $.revision, { revision: selectedFish.revision })}</p></div>
          <div className="fish-selected-actions">
            {selected && !showDraft && <Button variant={follow ? "brand" : "outline"} size="icon-sm" aria-label={follow ? t($ => $.stop_follow) : t($ => $.follow)} aria-pressed={follow} onClick={() => setFollow(v => !v)}><Crosshair /></Button>}
            {canRelease && releaseCandidate && <Button variant="outline" size="sm" disabled={busy || activeQuery.isPending || publicQuery.isPending} onClick={() => release(releaseCandidate)}>{t($ => $.release_public)}</Button>}
            {!shared && selectedOwn && publicQuery.data?.focus && <AppLink href={`${paths.fish()}?resident=${encodeURIComponent(publicQuery.data.focus.id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>{t($ => $.trench)}</AppLink>}
            {canApply && <Button variant="outline" size="sm" disabled={busy} onClick={() => apply(selected, draft)}>{t($ => $.apply)}</Button>}
            {selected && selectedOwn && !showDraft && <Button variant="outline" size="sm" disabled={busy} onClick={() => recall(selected)}>{t($ => $.recall)}</Button>}
            <Button variant="ghost" size="icon-sm" aria-label={t($ => $.close)} onClick={() => navigate()}><X /></Button>
          </div>
          {canRelease && <p className="fish-release-note">{t($ => $.release_visibility)}</p>}
        </aside>}
        {selectionMissing && <div className="fish-selection-status" role="status">{t($ => $.selection_missing)}</div>}
      </>}
    </section>
    {shared && (cursor || publicQuery.data?.nextCursor) && <nav className="fish-ocean-navigation" aria-label={t($ => $.explore_ocean)}>
      {cursor && <AppLink href={paths.fish()} className={buttonVariants({ variant: "outline", size: "sm" })}>{t($ => $.first_school)}</AppLink>}
      {publicQuery.data?.nextCursor && <AppLink href={`${paths.fish()}?cursor=${encodeURIComponent(publicQuery.data.nextCursor)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>{t($ => $.next_school)}</AppLink>}
    </nav>}
  </div>;
}
