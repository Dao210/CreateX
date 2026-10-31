"use client";

import { applyTankGrowth, tankGrowth } from "@auro/core/tank-defense";
import { TankGrowth } from "./tank-growth";
import { useTankTraining } from "./use-tank-training";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { ApiError } from "@auro/core/api";
import type { StorageAdapter } from "@auro/core/types";
import { TANK_LEVELS, tankCharactersOptions, tankSessionOptions, useCreateTankSession, type TankCharacter, type TankMode } from "@auro/core/tank-defense";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { PageHeader } from "../layout/page-header";
import { TankBattle } from "./tank-battle";
import { TankCharacterEditor } from "./tank-character-editor";
import { TankMCPConnection } from "./tank-mcp-connection";
import { TankConnectionReturn } from "./tank-connection-return";

export function TankGarage({ storage, storageKey, workspace, userId }: { storage: StorageAdapter; storageKey: string; workspace: { id: string; slug: string; name?: string }; userId: string }) {
  const { t } = useT("tanks");
  const navigation = useNavigation();
  const sessionId = navigation.searchParams.get("session") ?? "";
  const requestedCharacter = navigation.searchParams.get("character");
  const requestedStage = Number(navigation.searchParams.get("stage") ?? "");
  const initialLevelIndex = Number.isInteger(requestedStage) && requestedStage >= 1 && requestedStage <= TANK_LEVELS.length ? requestedStage - 1 : 0;
  const library = useQuery(tankCharactersOptions(workspace.id));
  const session = useQuery(tankSessionOptions(workspace.id, userId, sessionId));
  const create = useCreateTankSession(workspace.id);
  const [autoStartId, setAutoStartId] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<TankMode | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TankCharacter | null>(null);
  const request = useRef<{ input: string; id: string } | null>(null);
  const frozen = sessionId ? session.data : undefined;
  const training = useTankTraining(workspace.id, frozen, userId);
  const deployedBlueprint = frozen ? frozen.loadout ?? applyTankGrowth(frozen.character.blueprint, frozen.progression?.xp) : undefined;
  const currentId = requestedCharacter ?? frozen?.character.id ?? "";
  const currentMap = selectedMap ?? frozen?.mapId ?? "frontline";
  const currentMode = selectedMode ?? frozen?.mode ?? "campaign";
  const selected = library.data?.find(character => character.id === currentId);
  const selectedBlueprint = selected ? applyTankGrowth(selected.blueprint, selected.progression?.xp) : undefined;
  const path = `/${workspace.slug}/tanks`;
  const connections = <TankMCPConnection workspace={workspace} userId={userId} />;
  const selectCharacter = (id: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    if (id || sessionId) params.set("character", id);
    else params.delete("character");
    create.reset();
    navigation.replace(`${path}${params.size ? `?${params}` : ""}`);
  };
  const selectionChanged = currentId !== (frozen?.character.id ?? "");
  const launchError = create.isError ? create.error instanceof ApiError && create.error.status === 409 ? t($ => $.garage.conflict) : t($ => $.garage.save_error) : undefined;
  const characterUnavailable = selectionChanged && Boolean(currentId && !selected && !library.isPending);

  if (sessionId && (session.isPending || session.isError || !session.data)) {
    return <main className="tank-defense-page"><PageHeader><h1 className="flex-1 text-body font-medium">{t($ => $.title)}</h1>{connections}</PageHeader>
      <div className="tank-session-state" role={session.isError ? "alert" : "status"}>
        <p>{session.isError ? t($ => $.garage.session_error) : t($ => $.garage.loading_session)}</p>
        {session.isError && <><Button variant="outline" onClick={() => void session.refetch()}>{t($ => $.garage.refresh)}</Button><Button onClick={() => navigation.replace(path)}>{t($ => $.garage.return_classic)}</Button></>}
      </div></main>;
  }

  const deploy = async (begin = false) => {
    try { await training.finishActive(); } catch { return; }
    if (!currentId) { setAutoStartId(begin ? "classic" : null); navigation.replace(path); return; }
    const map = TANK_LEVELS.find(level => level.key === currentMap);
    if (!selected || !map) return;
    const input = { characterId: selected.id, revision: selected.revision, contentHash: selected.contentHash, mapId: map.key, mode: currentMode };
    const serialized = JSON.stringify(input);
    if (request.current?.input !== serialized) request.current = { input: serialized, id: crypto.randomUUID() };
    try {
      const result = await create.mutateAsync({ ...input, requestId: request.current.id });
      request.current = null;
      setAutoStartId(begin ? result.id : null);
      navigation.replace(result.playPath);
    } catch { /* The mutation keeps the selected character and exposes retry. */ }
  };

  const garage = <section className="tank-garage" aria-label={t($ => $.garage.title)}>
    <div className="tank-garage-heading"><h2>{t($ => $.garage.title)}</h2>
      <Button variant="ghost" size="icon-sm" aria-label={t($ => $.garage.refresh)} disabled={library.isFetching} onClick={() => void library.refetch()}><RefreshCw /></Button>
      <Button variant="ghost" size="icon-sm" aria-label={t($ => $.garage.create)} onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus /></Button>
    </div>
    {frozen && <p className="tank-frozen-loadout" data-testid="tank-frozen-character">{t($ => $.garage.frozen, { name: frozen.character.draft.name, revision: frozen.character.revision })}</p>}
    <label className="tank-form-field"><span>{t($ => $.garage.character)}</span><select value={currentId} disabled={create.isPending} onChange={event => selectCharacter(event.currentTarget.value)}>
      <option value="">{t($ => $.garage.classic)}</option>
      {frozen && !library.data?.some(character => character.id === frozen.character.id) && <option value={frozen.character.id}>{frozen.character.draft.name}{` · v${frozen.character.revision}`}</option>}
      {library.data?.map(character => <option key={character.id} value={character.id}>{character.draft.name}{` · v${character.revision}`}</option>)}
    </select></label>
    {library.isError && <div role="alert" className="tank-garage-error">{t($ => $.garage.library_error)}</div>}
    {characterUnavailable && !library.isError && <p role="alert" className="tank-garage-error">{t($ => $.garage.character_unavailable)}</p>}
    {!library.isPending && !library.isError && !library.data?.length && <p>{t($ => $.garage.empty)}</p>}
    {selected && <>
      <TankGrowth xp={selected.progression?.xp} />
      <div className="tank-character-swatch"><i style={{ backgroundColor: selected.draft.appearance.body, borderColor: selected.draft.appearance.accent }} aria-hidden /><span>{t($ => $.garage.stats, { speed: selectedBlueprint!.speed, armor: selectedBlueprint!.armor, cooldown: selectedBlueprint!.fireInterval })}</span></div>
      <label className="tank-form-field"><span>{t($ => $.garage.start_map)}</span><select value={currentMap} disabled={create.isPending} onChange={event => setSelectedMap(event.currentTarget.value)}>{TANK_LEVELS.map(level => <option key={level.key} value={level.key}>{t($ => $.levels[level.key].name)}</option>)}</select></label>
      <label className="tank-form-field"><span>{t($ => $.mode)}</span><select value={currentMode} disabled={create.isPending} onChange={event => { const value = event.currentTarget.value; if (value === "campaign" || value === "blitz" || value === "survival") setSelectedMode(value); }}>{(["campaign", "blitz", "survival"] as const).map(mode => <option key={mode} value={mode}>{t($ => $.modes[mode].name)}</option>)}</select></label>
    </>}
    <div className="tank-garage-actions"><Button size="sm" disabled={create.isPending || training.busy || training.settleError || Boolean(currentId && !selected)} aria-busy={create.isPending} onClick={() => void deploy()}>{create.isPending ? t($ => $.garage.deploying) : t($ => $.garage.deploy)}</Button>
      {selected?.ownerId === userId && <Button size="icon-sm" variant="outline" aria-label={t($ => $.garage.edit)} onClick={() => { setEditing(selected); setEditorOpen(true); }}><Wrench /></Button>}
    </div>
    {training.startError && <p role="alert">{t($ => $.growth.start_error)}</p>}
    {training.settleError && <div role="alert"><p>{t($ => $.growth.settle_error)}</p><Button size="sm" variant="outline" disabled={training.busy} onClick={training.retry}>{t($ => $.growth.retry)}</Button></div>}
    {training.result?.characterId === currentId && <p role="status">{t($ => $.growth.awarded, { xp: training.result.awardedXp, level: tankGrowth(training.result.progression.xp).level })}</p>}
    {frozen && selected && tankGrowth(selected.progression?.xp).level > tankGrowth(frozen.progression?.xp).level && <p>{t($ => $.growth.redeploy)}</p>}
    <p>{t($ => $.garage.new_battle_help)}</p>
  </section>;

  return <>
    <TankBattle
      key={sessionId || "classic"} storage={storage} storageKey={storageKey} workspaceId={workspace.id}
      training={training} blueprint={deployedBlueprint} levelIndex={frozen ? frozen.levelId - 1 : initialLevelIndex} initialMode={frozen?.mode}
      frozen={Boolean(frozen)} garage={garage} headerActions={connections}
      notice={<TankConnectionReturn />}
      onStart={selectionChanged ? () => void deploy(true) : undefined}
      startDisabled={selectionChanged && Boolean(currentId && !selected)} startPending={create.isPending}
      autoStart={autoStartId === (sessionId || "classic")}
      readyLoadout={selectionChanged ? selected && { name: selected.draft.name, blueprint: selectedBlueprint! } : frozen && { name: frozen.character.draft.name, blueprint: deployedBlueprint! }}
      launchError={launchError}
    />
    <TankCharacterEditor key={editorOpen ? editing ? `${editing.id}@${editing.revision}` : "new" : "closed"} open={editorOpen} onOpenChange={setEditorOpen} workspaceId={workspace.id} character={editing} onSaved={character => { selectCharacter(character.id); setEditorOpen(false); }} />
  </>;
}
