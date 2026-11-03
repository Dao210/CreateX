"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Gamepad2, Globe2, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { adminGamesOptions, gameAuditOptions, gamePreviewOptions, gameWorldsOptions, previewGameForWorld, useUpdateGamePolicy, type AdminGame, type GameWorld, type UpdateGamePolicyInput } from "@auro/core/admin";
import { ApiError } from "@auro/core/api";
import { Button } from "@auro/ui/components/ui/button";
import { Switch } from "@auro/ui/components/ui/switch";
import { useT } from "../i18n";

export function GameManager({ userId }: { userId: string }) {
  const { t } = useT("admin");
  const { t: layout } = useT("layout");
  const query = useQuery(adminGamesOptions(userId));
  const [selectedId, setSelectedId] = useState("");
  if (query.isPending) return <div className="admin-state" role="status"><Loader2 className="animate-spin" />{t($ => $.loading)}</div>;
  if (query.isError && !query.data) return <div className="admin-state" role="alert"><p>{t($ => $.load_error)}</p><Button variant="outline" onClick={() => void query.refetch()}>{t($ => $.refresh)}</Button></div>;
  const games = query.data ?? [];
  const selected = games.find(game => game.policy.gameId === selectedId) ?? games[0];
  const gameName = (id: string) => id === "siege" ? layout($ => $.nav.siege) : id === "tanks" ? layout($ => $.nav.tanks) : id === "life" ? layout($ => $.nav.life) : id;
  return <div className="admin-content">
    {query.isError && <p role="alert" className="admin-game-note">{t($ => $.load_error)}</p>}
    <div className="admin-section-heading"><p>{t($ => $.games_scope_help)}</p><Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw />{t($ => $.refresh)}</Button></div>
    <div className="admin-game-catalog" aria-label={t($ => $.games_title)}>{games.map(game => <button type="button" key={game.policy.gameId} className="admin-game-card" aria-pressed={selected?.policy.gameId === game.policy.gameId} onClick={() => setSelectedId(game.policy.gameId)}>
      <Gamepad2 aria-hidden /><span className="admin-game-card-title">{gameName(game.policy.gameId)}</span>
      <span className="admin-game-card-scope">{t($ => $.game_scopes[game.policy.scope])}</span>
      <span className="admin-game-card-count">{t($ => $.game_world_count, { count: game.impact.available })}</span>
    </button>)}</div>
    {selected && <><GamePolicyEditor key={selected.policy.gameId} game={selected} userId={userId} name={gameName(selected.policy.gameId)} /><GameAudit key={`audit-${selected.policy.gameId}`} gameId={selected.policy.gameId} userId={userId} /></>}
  </div>;
}

function GamePolicyEditor({ game, userId, name }: { game: AdminGame; userId: string; name: string }) {
  const { t, i18n } = useT("admin");
  const [draft, setDraft] = useState<UpdateGamePolicyInput | null>(null);
  const [search, setSearch] = useState("");
  const [worldCursors, setWorldCursors] = useState<string[]>([]);
  const [addedWorlds, setAddedWorlds] = useState<GameWorld[]>([]);
  const [previewWorld, setPreviewWorld] = useState<GameWorld | null>(null);
  const update = useUpdateGamePolicy(userId);
  const value: UpdateGamePolicyInput = draft ?? { expectedRevision: game.policy.revision, scope: game.policy.scope, defaultVisible: game.policy.defaultVisible, overrides: game.policy.overrides };
  const conflict = Boolean(draft && draft.expectedRevision !== game.policy.revision && !update.isPending) || update.error instanceof ApiError && update.error.status === 409;
  const worlds = useQuery(gameWorldsOptions(userId, search, worldCursors.at(-1)));
  const preview = useQuery(gamePreviewOptions(userId, game.policy.gameId, value, Boolean(draft)));
  const impact = draft ? preview.data : game.impact;
  const knownWorlds = [...game.worlds, ...addedWorlds, ...(worlds.data?.items ?? []), ...(game.binding ? [game.binding.world] : [])];
  const change = (input: Partial<UpdateGamePolicyInput>) => { setDraft({ ...value, ...input }); update.reset(); };
  const save = async () => { try { await update.mutateAsync({ gameId: game.policy.gameId, input: value }); setDraft(null); } catch { /* Keep the reviewed policy and original revision for retry. */ } };
  const selectedPreview = previewWorld && previewGameForWorld(value, previewWorld.id);
  const results = worlds.data?.items ?? [];

  return <section className="admin-panel" aria-labelledby="game-policy-title">
    <div className="admin-panel-heading"><div><span className="admin-eyebrow">{t($ => $.game_policy)}</span><h2 id="game-policy-title">{name}</h2></div><span className="admin-tag">{t($ => $.game_exception_count, { count: value.overrides.length })}</span></div>
    <fieldset className="admin-game-fields" disabled={update.isPending}>
      <label className="admin-game-field"><span>{t($ => $.game_scope)}</span><select value={value.scope} onChange={event => change({ scope: event.target.value === "all" ? "all" : event.target.value === "selected" ? "selected" : "disabled" })}>
        {(["all", "selected", "disabled"] as const).map(scope => <option key={scope} value={scope}>{t($ => $.game_scopes[scope])}</option>)}
      </select></label>
      <label className="admin-game-field admin-game-toggle"><span>{t($ => $.game_default_visible)}</span><Switch checked={value.defaultVisible} disabled={update.isPending} onCheckedChange={defaultVisible => change({ defaultVisible })} /></label>
    </fieldset>
    <p className="admin-game-note">{t($ => $.game_visibility_help)}</p>
    {game.policy.gameId === "life" && <div className="admin-game-binding"><Globe2 aria-hidden /><div><strong>{game.binding?.world.name ?? t($ => $.game_uninitialized)}</strong>{game.binding && <span>{game.binding.world.slug} · {t($ => $.game_last_update, { time: new Date(game.binding.updatedAt).toLocaleString(i18n.language) })}</span>}<p>{t($ => $.game_binding_help)}</p></div></div>}

    <div className="admin-game-section"><h3>{t($ => $.game_exceptions)}</h3>
      {value.overrides.length > 0 ? <div className="admin-table-scroll"><table className="admin-table admin-game-table"><thead><tr><th>{t($ => $.game_world)}</th><th>{t($ => $.game_world_access)}</th><th>{t($ => $.game_world_visibility)}</th><th>{t($ => $.game_restore_inherit)}</th></tr></thead><tbody>
        {value.overrides.map(override => { const world = knownWorlds.find(item => item.id === override.workspaceId); return <tr key={override.workspaceId}>
          <td><Button size="xs" variant="link" onClick={() => setPreviewWorld(world ?? { id: override.workspaceId, name: override.workspaceId, slug: "" })}>{world?.name ?? override.workspaceId}</Button><small>{world?.slug}</small></td>
          <td><select aria-label={`${world?.name ?? override.workspaceId} · ${t($ => $.game_world_access)}`} value={override.access} disabled={update.isPending} onChange={event => change({ overrides: value.overrides.map(item => item.workspaceId === override.workspaceId ? { ...item, access: event.target.value === "allow" ? "allow" : event.target.value === "deny" ? "deny" : "inherit" } : item) })}>{(["inherit", "allow", "deny"] as const).map(key => <option key={key} value={key}>{t($ => $.game_access_values[key])}</option>)}</select></td>
          <td><select aria-label={`${world?.name ?? override.workspaceId} · ${t($ => $.game_world_visibility)}`} value={override.visibility} disabled={update.isPending} onChange={event => change({ overrides: value.overrides.map(item => item.workspaceId === override.workspaceId ? { ...item, visibility: event.target.value === "show" ? "show" : event.target.value === "hide" ? "hide" : "inherit" } : item) })}>{(["inherit", "show", "hide"] as const).map(key => <option key={key} value={key}>{t($ => $.game_visibility_values[key])}</option>)}</select></td>
          <td><Button size="icon-sm" variant="ghost" disabled={update.isPending} aria-label={`${t($ => $.game_restore_inherit)} · ${world?.name ?? override.workspaceId}`} onClick={() => change({ overrides: value.overrides.filter(item => item.workspaceId !== override.workspaceId) })}><Trash2 /></Button></td>
        </tr>; })}
      </tbody></table></div> : <p className="admin-game-note">{t($ => $.game_no_exceptions)}</p>}
      <label className="admin-game-search"><span>{t($ => $.game_find_world)}</span><input type="search" value={search} maxLength={100} placeholder={t($ => $.game_search_placeholder)} onChange={event => { setSearch(event.target.value); setWorldCursors([]); }} /></label>
      {worlds.isError && <p role="alert">{t($ => $.load_error)} <Button variant="link" size="xs" onClick={() => void worlds.refetch()}>{t($ => $.refresh)}</Button></p>}
      <div className="admin-world-results">{results.map(world => <div key={world.id}>
        <Button size="sm" variant="ghost" onClick={() => setPreviewWorld(world)}><Globe2 /><span className="admin-world-name">{world.name}<small>{world.slug}</small></span></Button>
        <Button size="icon-sm" variant="outline" aria-label={t($ => $.game_add_exception, { name: world.name })} disabled={update.isPending || value.overrides.some(item => item.workspaceId === world.id) || value.overrides.length >= 500} onClick={() => { setAddedWorlds(previous => [...previous, world]); change({ overrides: [...value.overrides, { workspaceId: world.id, access: "allow", visibility: "inherit" }] }); }}><Plus /></Button>
      </div>)}</div>
      <div className="admin-actions admin-world-pagination"><Button size="icon-sm" variant="outline" aria-label={t($ => $.previous)} disabled={!worldCursors.length || worlds.isFetching} onClick={() => setWorldCursors(worldCursors.slice(0, -1))}><ChevronLeft /></Button><Button size="icon-sm" variant="outline" aria-label={t($ => $.next)} disabled={!worlds.data?.nextCursor || worlds.isFetching} onClick={() => { const next = worlds.data?.nextCursor; if (next) setWorldCursors([...worldCursors, next]); }}><ChevronRight /></Button></div>
      {previewWorld && selectedPreview && <div className="admin-game-world-preview" role="status"><strong>{previewWorld.name}</strong><span>{t($ => selectedPreview.available ? $.game_available : $.game_unavailable)}</span><span>{t($ => selectedPreview.visible ? $.game_shown : $.game_hidden)}</span><span>{t($ => $.game_reasons[selectedPreview.reason])}</span></div>}
    </div>
    <div className="admin-policy-footer"><div>
      <p role="status">{impact ? t($ => $.game_impact, { available: impact.available, visible: impact.visible, total: impact.total }) : preview.isError ? t($ => $.game_preview_error) : t($ => $.loading)}</p>
      {draft && preview.isError && <Button variant="link" size="xs" onClick={() => void preview.refetch()}>{t($ => $.refresh)}</Button>}
      <p>{t($ => $.game_effect_help)}</p>
      {game.policy.updatedAt && <span>{t($ => $.updated_at, { revision: game.policy.revision, time: new Date(game.policy.updatedAt).toLocaleString(i18n.language) })}</span>}
      {(conflict || update.isError) && <p role="alert" className="admin-error">{t($ => conflict ? $.conflict : $.save_error)}</p>}
    </div><div className="admin-actions">{draft && <Button variant="outline" disabled={update.isPending} onClick={() => { setDraft(null); update.reset(); }}>{t($ => $.reset)}</Button>}<Button disabled={!draft || conflict || update.isPending || !preview.isSuccess} aria-busy={update.isPending} onClick={() => void save()}>{update.isPending && <Loader2 className="animate-spin" />}{t($ => update.isPending ? $.saving : $.save)}</Button></div></div>
  </section>;
}

function GameAudit({ userId, gameId }: { userId: string; gameId: string }) {
  const { t, i18n } = useT("admin");
  const [cursors, setCursors] = useState<string[]>([]);
  const query = useQuery(gameAuditOptions(userId, gameId, cursors.at(-1)));
  return <section className="admin-panel" aria-labelledby="game-audit-title"><div className="admin-panel-heading"><h2 id="game-audit-title">{t($ => $.game_audit)}</h2><Button size="icon-sm" variant="ghost" aria-label={t($ => $.refresh_activity)} onClick={() => void query.refetch()}><RefreshCw /></Button></div>
    {query.isPending ? <p className="admin-game-note" role="status">{t($ => $.loading)}</p> : query.isError ? <p className="admin-game-note" role="alert">{t($ => $.load_error)}</p> : !query.data.items.length ? <p className="admin-game-note">{t($ => $.game_audit_empty)}</p> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>{t($ => $.time)}</th><th>{t($ => $.caller)}</th><th>{t($ => $.game_changes)}</th></tr></thead><tbody>{query.data.items.map(item => <tr key={item.revision}><td>{new Date(item.occurredAt).toLocaleString(i18n.language)}<small>{t($ => $.policy_revision, { revision: item.revision })}</small></td><td>{item.actorName || item.actorEmail}<small>{item.actorEmail}</small></td><td><details><summary>{t($ => $.game_view_changes)}</summary><div className="admin-game-audit-diff">{([item.previous, item.current] as const).map((policy, index) => <div key={index}><strong>{t($ => index === 0 ? $.game_before : $.game_after)}</strong><p>{t($ => $.game_scopes[policy.scope])} · {t($ => policy.defaultVisible ? $.game_shown : $.game_hidden)}</p><p>{t($ => $.game_exception_count, { count: policy.overrides.length })}</p>{policy.overrides.map(override => <p key={override.workspaceId}><code>{override.workspaceId}</code> · {t($ => $.game_access_values[override.access])} · {t($ => $.game_visibility_values[override.visibility])}</p>)}</div>)}</div></details></td></tr>)}</tbody></table></div>}
    <div className="admin-log-footer"><p>{t($ => $.game_audit_help)}</p><div className="admin-actions"><Button size="icon-sm" variant="outline" aria-label={t($ => $.previous)} disabled={!cursors.length || query.isFetching} onClick={() => setCursors(cursors.slice(0, -1))}><ChevronLeft /></Button><Button size="icon-sm" variant="outline" aria-label={t($ => $.next)} disabled={!query.data?.nextCursor || query.isFetching} onClick={() => { const next = query.data?.nextCursor; if (next) setCursors([...cursors, next]); }}><ChevronRight /></Button></div></div>
  </section>;
}
