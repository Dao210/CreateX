"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, RefreshCw, Shield, Star, Swords, Trophy, UserRound, Wrench } from "lucide-react";
import { useAuthStore } from "@auro/core/auth";
import { useCurrentWorkspace, useWorkspacePaths } from "@auro/core/paths";
import type { StorageAdapter } from "@auro/core/types";
import {
  CAMPAIGN_LEVELS,
  CampaignProgressSchema,
  SIEGE_CAMPAIGN_PROGRESS_KEY,
  compileWeapon,
  scopedSiegeStorage,
  siegePreferencesKey,
  unlockedLevel,
  type Drawing,
  type LibraryBlueprint,
  type WeaponSpec,
} from "@auro/core/siege";
import { createSiegeClient, siegeLibraryOptions } from "@auro/core/siege/queries";
import {
  TANK_LEVELS,
  myTankCharactersOptions,
  parseTankPreferences,
  tankPreferencesKey,
  type TankCharacter,
} from "@auro/core/tank-defense";
import { gameProgressOptions, mergeSiegeStars, mergeTankAchievements } from "@auro/core/game-progress";
import { ActorAvatar } from "@auro/ui/components/common/actor-avatar";
import { Badge } from "@auro/ui/components/ui/badge";
import { Button } from "@auro/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@auro/ui/components/ui/card";
import { Progress } from "@auro/ui/components/ui/progress";
import { AppLink } from "../navigation";
import { PageHeader } from "../layout/page-header";
import { useLocale, useT } from "../i18n";
import { BlueprintPreview } from "./blueprint-preview";

type Filter = "all" | "siege" | "tanks" | "mcp";

export function MePage({ storage }: { storage: StorageAdapter }) {
  const workspace = useCurrentWorkspace();
  const user = useAuthStore((state) => state.user);
  if (!workspace || !user) return null;
  return <MeContent key={`${workspace.id}:${user.id}`} storage={storage} workspace={workspace} userId={user.id} userName={user.name} avatarUrl={user.avatar_url} />;
}

function MeContent({ storage, workspace, userId, userName, avatarUrl }: {
  storage: StorageAdapter;
  workspace: { id: string; name: string; slug: string };
  userId: string;
  userName: string;
  avatarUrl?: string | null;
}) {
  const { t } = useT("me");
  const locale = useLocale();
  const paths = useWorkspacePaths();
  const [filter, setFilter] = useState<Filter>("all");
  const scope = useMemo(() => ({ workspaceId: workspace.id, workspaceSlug: workspace.slug, userId }), [workspace.id, workspace.slug, userId]);
  const siegeClient = useMemo(() => createSiegeClient(scope), [scope]);
  const tanks = useQuery(myTankCharactersOptions(workspace.id, userId));
  const library = useQuery(siegeLibraryOptions(siegeClient, scope));
  const remote = useQuery(gameProgressOptions(workspace.id));
  const local = useMemo(() => readLocalProgress(storage, userId, workspace.id), [storage, userId, workspace.id]);
  const stars = useMemo(() => mergeSiegeStars(local.stars, remote.data?.siege?.stars), [local.stars, remote.data?.siege?.stars]);
  const achievements = useMemo(() => mergeTankAchievements(local.tanks, remote.data?.tanks), [local.tanks, remote.data?.tanks]);
  const blueprints = library.data?.blueprints ?? [];
  const characters = tanks.data ?? [];
  const totalStars = stars.reduce((sum, value) => sum + value, 0);
  const mcpCharacters = characters.filter((character) => character.origin === "mcp");
  const showSiege = filter === "all" || filter === "siege";
  const showTanks = filter === "all" || filter === "tanks" || filter === "mcp";
  const visibleSiege = showSiege ? blueprints : [];
  const visibleTanks = filter === "mcp" ? mcpCharacters : showTanks ? characters : [];
  const siegeFailed = showSiege && library.isError;
  const tanksFailed = showTanks && tanks.isError;
  const loading = (showSiege && library.isPending) || (showTanks && tanks.isPending);
  const bothFailed = siegeFailed && tanksFailed;
  const nothing = !loading && !siegeFailed && !tanksFailed && visibleSiege.length === 0 && visibleTanks.length === 0;
  const nextLevel = unlockedLevel(stars);
  const completed = totalStars === CAMPAIGN_LEVELS.length * 3;
  const syncState = remote.isError ? t(($) => $.progress.offline) : remote.data?.siege || remote.data?.tanks ? t(($) => $.progress.synced) : t(($) => $.progress.local);

  return <>
    <PageHeader>
      <UserRound className="size-4 text-muted-foreground" aria-hidden />
      <h1 className="min-w-0 flex-1 truncate text-body font-medium">{t(($) => $.title)}</h1>
    </PageHeader>
    <div className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-12 pt-4">
      <section className="overflow-hidden rounded-2xl border border-surface-border bg-surface p-5 shadow-[var(--surface-shadow)]">
        <div className="flex flex-wrap items-center gap-4">
          <ActorAvatar name={userName} initials={initials(userName)} avatarUrl={avatarUrl} size="2xl" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title-sm font-medium">{userName}</h2>
            <p className="truncate text-caption text-muted-foreground">{workspace.name}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat icon={<Swords />} label={t(($) => $.summary.weapons)} value={blueprints.length + characters.length} />
          <Stat icon={<Star />} label={t(($) => $.summary.stars)} value={`${totalStars} / ${CAMPAIGN_LEVELS.length * 3}`} />
          <Stat icon={<Trophy />} label={t(($) => $.summary.best)} value={String(achievements.best).padStart(6, "0")} />
        </div>
      </section>

      <section aria-labelledby="me-weapons-title">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="me-weapons-title" className="mr-auto text-title-sm font-medium">{t(($) => $.weapons.title)}</h2>
          {(["all", "siege", "tanks", "mcp"] as const).map((value) => <Button key={value} size="xs" variant={filter === value ? "brand" : "outline"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(($) => $.filters[value])}</Button>)}
        </div>
        {bothFailed ? <ErrorCard message={t(($) => $.error)} retry={() => { void library.refetch(); void tanks.refetch(); }} retryLabel={t(($) => $.retry)} /> : <>
          {(visibleSiege.length > 0 || visibleTanks.length > 0) && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleSiege.map((blueprint) => <SiegeCard key={blueprint.id} blueprint={blueprint} locale={locale} workshopHref={`${paths.siege()}?blueprint=${encodeURIComponent(blueprint.id)}`} />)}
            {visibleTanks.map((character) => <TankCard key={character.id} character={character} locale={locale} garageHref={`${paths.tanks()}?character=${encodeURIComponent(character.id)}`} />)}
          </div>}
          {(siegeFailed || tanksFailed) && <div className={`space-y-2 ${visibleSiege.length > 0 || visibleTanks.length > 0 ? "mt-3" : ""}`}>
            {siegeFailed && <p role="alert" className="text-caption text-destructive">{t(($) => $.weapons.siege_error)} <Button size="xs" variant="link" onClick={() => void library.refetch()}>{t(($) => $.retry)}</Button></p>}
            {tanksFailed && <p role="alert" className="text-caption text-destructive">{t(($) => $.weapons.tanks_error)} <Button size="xs" variant="link" onClick={() => void tanks.refetch()}>{t(($) => $.retry)}</Button></p>}
          </div>}
          {nothing && <EmptyCollection filter={filter} workshopHref={paths.siege()} garageHref={paths.tanks()} />}
        </>}
        {loading && <p role="status" className="mt-3 text-caption text-muted-foreground">{t(($) => $.loading)}</p>}
      </section>

      <section aria-labelledby="me-progress-title" className="space-y-3">
        <div className="flex items-center gap-2"><h2 id="me-progress-title" className="mr-auto text-title-sm font-medium">{t(($) => $.progress.title)}</h2><Badge variant="outline">{syncState}</Badge></div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t(($) => $.progress.siege_title)}</CardTitle>
              <CardDescription>{t(($) => $.progress.stars, { earned: totalStars, total: CAMPAIGN_LEVELS.length * 3 })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-2">{stars.map((value, index) => <div key={index} role="img" className="rounded-lg border border-border p-2" aria-label={t(($) => $.progress.level_stars, { level: index + 1, stars: value })}><span className="text-caption tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><div className="mt-1 flex gap-0.5">{[0, 1, 2].map((star) => <Star key={star} className={`size-3 ${star < value ? "fill-current text-brand" : "text-muted-foreground/30"}`} aria-hidden />)}</div></div>)}</div>
              <p className="text-caption text-muted-foreground">{completed ? t(($) => $.progress.campaign_complete) : t(($) => $.progress.next_level, { level: nextLevel })}</p>
              <Button size="sm" variant="outline" render={<AppLink href={`${paths.siege()}/campaign?level=${nextLevel}`} />}>{t(($) => $.progress.continue_siege)}<ArrowRight /></Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t(($) => $.progress.tanks_title)}</CardTitle>
              <CardDescription>{t(($) => $.progress.best, { score: String(achievements.best).padStart(6, "0") })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={achievements.unlocked / TANK_LEVELS.length * 100} aria-label={t(($) => $.progress.unlocked, { unlocked: achievements.unlocked, total: TANK_LEVELS.length })} />
              <p className="text-caption text-muted-foreground">{t(($) => $.progress.unlocked, { unlocked: achievements.unlocked, total: TANK_LEVELS.length })}</p>
              <Button size="sm" variant="outline" render={<AppLink href={`${paths.tanks()}?stage=${achievements.unlocked}`} />}>{t(($) => $.progress.continue_tanks)}<ArrowRight /></Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  </>;
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return <div className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3 py-2.5"><span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-4">{icon}</span><div className="min-w-0"><p className="truncate text-caption text-muted-foreground">{label}</p><p className="truncate text-body font-medium tabular-nums">{value}</p></div></div>;
}

function SiegeCard({ blueprint, locale, workshopHref }: { blueprint: LibraryBlueprint; locale: string; workshopHref: string }) {
  const { t } = useT("me");
  const definition = useMemo(() => {
    if (!blueprint.spec) return null;
    try { return compileWeapon(blueprint.drawing, blueprint.spec, blueprint.spec.drawingHash, blueprint.cannonDesign); }
    catch { return null; }
  }, [blueprint]);
  const kind = weaponKind(blueprint.spec);
  const kindLabel = kind === "cannon" ? t(($) => $.weapons.kind_cannon) : kind === "blade" ? t(($) => $.weapons.kind_blade) : kind === "hammer" ? t(($) => $.weapons.kind_hammer) : t(($) => $.weapons.kind_mixed);
  return <Card size="sm" className="h-full overflow-hidden">
    <div className="flex aspect-[4/3] items-center justify-center bg-muted/25 p-4 text-foreground/80"><BlueprintPreview drawing={blueprint.drawing as Drawing} className="h-full w-full" /></div>
    <CardHeader className="gap-1">
      <div className="flex min-w-0 items-center gap-2"><CardTitle className="truncate">{blueprint.name}</CardTitle><Badge variant="secondary">{kindLabel}</Badge></div>
      <CardDescription>{t(($) => $.weapons.created, { date: formatDate(blueprint.createdAt, locale) })}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground">
        {definition && <span>{t(($) => $.weapons.range, { range: Math.round(definition.launcher?.range ?? definition.reach) })}</span>}
        {definition && <span>{t(($) => $.weapons.ink, { ink: Math.round(definition.ink) })}</span>}
        <span>{t(($) => $.weapons.parts, { count: blueprint.spec?.parts.length ?? 0 })}</span>
      </div>
      <Button size="xs" variant="outline" render={<AppLink href={workshopHref} />}>{t(($) => $.weapons.open_workshop)}</Button>
    </CardContent>
  </Card>;
}

function TankCard({ character, locale, garageHref }: { character: TankCharacter; locale: string; garageHref: string }) {
  const { t } = useT("me");
  const appearance = character.draft.appearance;
  return <Card size="sm" className="h-full overflow-hidden">
    <div className="flex aspect-[4/3] items-center justify-center bg-muted/25 p-4"><TankPreview body={appearance.body} accent={appearance.accent} pattern={appearance.pattern} /></div>
    <CardHeader className="gap-1">
      <div className="flex min-w-0 items-center gap-2"><CardTitle className="truncate">{character.draft.name}</CardTitle><Badge variant={character.origin === "mcp" ? "default" : "secondary"}>{character.origin === "mcp" ? t(($) => $.weapons.mcp) : t(($) => $.weapons.manual)}</Badge></div>
      <CardDescription>{t(($) => $.weapons.revision, { revision: character.revision })} · {t(($) => $.weapons.created, { date: formatDate(character.createdAt, locale) })}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <p className="text-caption text-muted-foreground">{t(($) => $.weapons.stats, { speed: character.blueprint.speed, armor: character.blueprint.armor, cooldown: character.blueprint.fireInterval })}</p>
      <div className="flex flex-wrap gap-2"><Button size="xs" variant="outline" render={<AppLink href={garageHref} />}>{t(($) => $.weapons.open_garage)}</Button><Badge variant="outline">{t(($) => $.weapons.cost, { cost: character.cost })}</Badge></div>
    </CardContent>
  </Card>;
}

function TankPreview({ body, accent, pattern }: { body: string; accent: string; pattern: string }) {
  return <svg viewBox="0 0 120 80" className="h-full w-full" role="img" aria-hidden>
    <rect x="18" y="54" width="84" height="12" rx="6" fill={body} opacity="0.55" />
    <rect x="26" y="36" width="68" height="22" rx="6" fill={body} />
    <rect x="42" y="28" width="28" height="16" rx="6" fill={accent} />
    <rect x="68" y="32" width="30" height="6" rx="3" fill={accent} />
    {pattern === "stripe" && <rect x="34" y="44" width="52" height="4" rx="2" fill={accent} opacity="0.75" />}
    {pattern === "cross" && <><rect x="56" y="36" width="8" height="22" fill={accent} opacity="0.7" /><rect x="26" y="44" width="68" height="6" fill={accent} opacity="0.7" /></>}
  </svg>;
}

function ErrorCard({ message, retry, retryLabel }: { message: string; retry: () => void; retryLabel: string }) {
  return <Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center"><p className="text-body text-muted-foreground">{message}</p><Button size="sm" variant="outline" onClick={retry}><RefreshCw />{retryLabel}</Button></CardContent></Card>;
}

function EmptyCollection({ filter, workshopHref, garageHref }: { filter: Filter; workshopHref: string; garageHref: string }) {
  const { t } = useT("me");
  const Icon = filter === "siege" ? Wrench : filter === "tanks" ? Shield : Bot;
  const message = filter === "siege" ? t(($) => $.weapons.siege_empty) : filter === "tanks" ? t(($) => $.weapons.tanks_empty) : filter === "mcp" ? t(($) => $.weapons.mcp_empty) : t(($) => $.weapons.empty_help);
  return <Card><CardContent className="flex flex-col items-center gap-3 py-10 text-center">
    <Icon className="size-8 text-muted-foreground" aria-hidden />
    <p className="max-w-md text-body text-muted-foreground">{message}</p>
    {filter === "all" && <div className="flex flex-wrap justify-center gap-2"><Button size="sm" render={<AppLink href={workshopHref} />}><Wrench />{t(($) => $.weapons.open_workshop)}</Button><Button size="sm" variant="outline" render={<AppLink href={garageHref} />}><Shield />{t(($) => $.weapons.open_garage)}</Button></div>}
    {filter === "siege" && <Button size="sm" render={<AppLink href={workshopHref} />}><Wrench />{t(($) => $.weapons.open_workshop)}</Button>}
    {filter === "tanks" && <Button size="sm" render={<AppLink href={garageHref} />}><Shield />{t(($) => $.weapons.open_garage)}</Button>}
  </CardContent></Card>;
}

function readLocalProgress(storage: StorageAdapter, userId: string, workspaceId: string): { stars: number[]; tanks: { best: number; unlocked: number } } {
  let stars: number[] = Array(CAMPAIGN_LEVELS.length).fill(0);
  let tanks = { best: 0, unlocked: 1 };
  try {
    const raw = scopedSiegeStorage(storage, siegePreferencesKey(userId, workspaceId)).getItem(SIEGE_CAMPAIGN_PROGRESS_KEY);
    if (raw) {
      const parsed = CampaignProgressSchema.safeParse(JSON.parse(raw));
      if (parsed.success) stars = parsed.data.stars;
    }
  } catch { /* A broken local record must not hide the server collection. */ }
  try { tanks = parseTankPreferences(storage.getItem(tankPreferencesKey(userId, workspaceId))); }
  catch { /* Same fallback as the games: local records are optional. */ }
  return { stars, tanks };
}

function weaponKind(spec: WeaponSpec | null): "cannon" | "blade" | "hammer" | "mixed" {
  const types = new Set(spec?.parts.map((part) => part.type) ?? []);
  const cannon = types.has("cannon"), blade = types.has("blade"), hammer = types.has("hammer");
  if (cannon && !blade && !hammer) return "cannon";
  if (blade && !cannon && !hammer) return "blade";
  if (hammer && !cannon && !blade) return "hammer";
  return "mixed";
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}
