"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, Globe2, Play, RefreshCw, Shapes, Shield, Star, Trophy, Wrench } from "lucide-react";
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
  applyTankGrowth,
  TANK_LEVELS,
  TANK_DIFFICULTIES,
  myTankCharactersOptions,
  parseTankPreferences,
  tankPreferencesKey,
  useCreateTankSession,
  type TankCharacter,
} from "@auro/core/tank-defense";
import { gameProgressOptions, mergeSiegeStars, mergeTankAchievements } from "@auro/core/game-progress";
import { Badge } from "@auro/ui/components/ui/badge";
import { Button, buttonVariants } from "@auro/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@auro/ui/components/ui/card";
import { Progress } from "@auro/ui/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@auro/ui/components/ui/tabs";
import { AppLink, useNavigation } from "../navigation";
import { PageHeader } from "../layout/page-header";
import { useLocale, useT } from "../i18n";
import { BlueprintPreview } from "./blueprint-preview";
import { TankGrowth } from "../tank-defense/tank-growth";
import { TankPreview } from "../tank-defense/tank-preview";

type Filter = "all" | "siege" | "tanks" | "mcp";

export function MePage({ storage }: { storage: StorageAdapter }) {
  const workspace = useCurrentWorkspace();
  const user = useAuthStore((state) => state.user);
  if (!workspace || !user) return null;
  return <MeContent key={`${workspace.id}:${user.id}`} storage={storage} workspace={workspace} userId={user.id} />;
}

function MeContent({ storage, workspace, userId }: {
  storage: StorageAdapter;
  workspace: { id: string; name: string; slug: string };
  userId: string;
}) {
  const { t } = useT("me");
  const locale = useLocale();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const tab = navigation.searchParams.get("tab") === "progress" ? "progress" : "creations";
  const requestedFilter = navigation.searchParams.get("filter");
  const filter: Filter = requestedFilter === "siege" || requestedFilter === "tanks" || requestedFilter === "mcp" ? requestedFilter : "all";
  const setView = (key: "tab" | "filter", value: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    if (value === "creations" || value === "all") params.delete(key);
    else params.set(key, value);
    navigation.replace(`${navigation.pathname}${params.size ? `?${params}` : ""}${navigation.hash}`);
  };
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
      <Shapes className="size-4 text-muted-foreground" aria-hidden />
      <h1 className="min-w-0 flex-1 truncate text-body font-medium">{t(($) => $.title)}</h1>
    </PageHeader>
    <div className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-12 pt-4">
      <section className="space-y-4">
        <p className="flex min-w-0 items-start gap-2 text-caption text-muted-foreground">
          <Globe2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{t(($) => $.scope, { name: workspace.name })}</span>
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat icon={<Shapes />} label={t(($) => $.summary.weapons)} value={blueprints.length + characters.length} />
          <Stat icon={<Star />} label={t(($) => $.summary.stars)} value={`${totalStars} / ${CAMPAIGN_LEVELS.length * 3}`} />
          <Stat icon={<Trophy />} label={t(($) => $.summary.best)} value={String(achievements.best).padStart(6, "0")} />
        </div>
      </section>

      <Tabs value={tab} onValueChange={(value) => setView("tab", String(value))} className="gap-5">
        <TabsList variant="line" aria-label={t(($) => $.tabs.label)}>
          <TabsTrigger value="creations">{t(($) => $.tabs.creations)}</TabsTrigger>
          <TabsTrigger value="progress">{t(($) => $.progress.title)}</TabsTrigger>
        </TabsList>
        <TabsContent value="creations">
          <section aria-labelledby="me-weapons-title">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 id="me-weapons-title" className="mr-auto text-title-sm font-medium">{t(($) => $.weapons.title)}</h2>
              {(["all", "siege", "tanks", "mcp"] as const).map((value) => <Button key={value} size="xs" variant={filter === value ? "brand" : "outline"} aria-pressed={filter === value} onClick={() => setView("filter", value)}>{t(($) => $.filters[value])}</Button>)}
            </div>
            {bothFailed ? <ErrorCard message={t(($) => $.error)} retry={() => { void library.refetch(); void tanks.refetch(); }} retryLabel={t(($) => $.retry)} /> : <>
              {(visibleSiege.length > 0 || visibleTanks.length > 0) && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleSiege.map((blueprint) => <SiegeCard key={blueprint.id} blueprint={blueprint} locale={locale} workshopHref={`${paths.siege()}?blueprint=${encodeURIComponent(blueprint.id)}`} />)}
                {visibleTanks.map((character) => <TankCard key={character.id} character={character} locale={locale} workspaceId={workspace.id} power={TANK_DIFFICULTIES[local.tanks.difficulty].initialPower} garageHref={`${paths.tanks()}?character=${encodeURIComponent(character.id)}`} />)}
              </div>}
              {(siegeFailed || tanksFailed) && <div className={`space-y-2 ${visibleSiege.length > 0 || visibleTanks.length > 0 ? "mt-3" : ""}`}>
                {siegeFailed && <p role="alert" className="text-caption text-destructive">{t(($) => $.weapons.siege_error)} <Button size="xs" variant="link" onClick={() => void library.refetch()}>{t(($) => $.retry)}</Button></p>}
                {tanksFailed && <p role="alert" className="text-caption text-destructive">{t(($) => $.weapons.tanks_error)} <Button size="xs" variant="link" onClick={() => void tanks.refetch()}>{t(($) => $.retry)}</Button></p>}
              </div>}
              {nothing && <EmptyCollection filter={filter} workshopHref={paths.siege()} garageHref={paths.tanks()} />}
            </>}
            {loading && <p role="status" className="mt-3 text-caption text-muted-foreground">{t(($) => $.loading)}</p>}
          </section>
        </TabsContent>
        <TabsContent value="progress">
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
                  <AppLink href={`${paths.siege()}/campaign?level=${nextLevel}`} className={buttonVariants({ size: "sm", variant: "outline" })}>{t(($) => $.progress.continue_siege)}<ArrowRight /></AppLink>
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
                  <AppLink href={`${paths.tanks()}?stage=${achievements.unlocked}`} className={buttonVariants({ size: "sm", variant: "outline" })}>{t(($) => $.progress.continue_tanks)}<ArrowRight /></AppLink>
                </CardContent>
              </Card>
            </div>
          </section>
        </TabsContent>
      </Tabs>
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
      <AppLink href={workshopHref} className={buttonVariants({ size: "xs", variant: "outline" })}>{t(($) => $.weapons.open_workshop)}</AppLink>
    </CardContent>
  </Card>;
}

function TankCard({ character, locale, garageHref, workspaceId, power }: { character: TankCharacter; locale: string; garageHref: string; workspaceId: string; power: number }) {
  const { t } = useT("me");
  const { t: tankT } = useT("tanks");
  const grownBlueprint = applyTankGrowth(character.blueprint, character.progression?.xp);
  const navigation = useNavigation();
  const create = useCreateTankSession(workspaceId);
  const request = useRef<{ input: string; id: string } | null>(null);
  const play = async () => {
    const input = { characterId: character.id, revision: character.revision, contentHash: character.contentHash, mapId: "frontline" as const, mode: "campaign" as const };
    const serialized = JSON.stringify(input);
    if (request.current?.input !== serialized) request.current = { input: serialized, id: crypto.randomUUID() };
    try {
      const session = await create.mutateAsync({ ...input, requestId: request.current.id });
      request.current = null;
      navigation.push(session.playPath);
    } catch { /* The mutation exposes retry without losing the character. */ }
  };
  return <Card size="sm" className="h-full overflow-hidden" role="group" aria-label={character.draft.name}>
    <div className="flex aspect-[4/3] items-center justify-center bg-muted/25 p-4"><TankPreview blueprint={grownBlueprint} name={character.draft.name} power={power} className="h-full max-h-40 w-auto" /></div>
    <CardHeader className="gap-1">
      <div className="flex min-w-0 items-center gap-2"><CardTitle className="truncate">{character.draft.name}</CardTitle><Badge variant={character.origin === "mcp" ? "default" : "secondary"}>{character.origin === "mcp" ? t(($) => $.weapons.mcp) : t(($) => $.weapons.manual)}</Badge></div>
      <CardDescription>{t(($) => $.weapons.revision, { revision: character.revision })} · {t(($) => $.weapons.created, { date: formatDate(character.createdAt, locale) })}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <TankGrowth xp={character.progression?.xp} />
      <p className="text-caption text-muted-foreground">{t(($) => $.weapons.stats, { speed: grownBlueprint.speed, armor: grownBlueprint.armor, cooldown: grownBlueprint.fireInterval })}</p>
      <div className="flex flex-wrap items-center gap-2"><Button size="xs" disabled={create.isPending} aria-busy={create.isPending} onClick={() => void play()}><Play />{create.isPending ? tankT(($) => $.garage.deploying) : t(($) => $.weapons.play)}</Button><AppLink href={garageHref} className={buttonVariants({ size: "xs", variant: "outline" })}>{t(($) => $.weapons.open_garage)}</AppLink><Badge variant="outline">{t(($) => $.weapons.cost, { cost: character.cost })}</Badge></div>
      {create.isError && <p role="alert" className="text-caption text-destructive">{tankT(($) => $.garage.save_error)}</p>}
    </CardContent>
  </Card>;
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
    {filter === "all" && <div className="flex flex-wrap justify-center gap-2"><AppLink href={workshopHref} className={buttonVariants({ size: "sm" })}><Wrench />{t(($) => $.weapons.open_workshop)}</AppLink><AppLink href={garageHref} className={buttonVariants({ size: "sm", variant: "outline" })}><Shield />{t(($) => $.weapons.open_garage)}</AppLink></div>}
    {filter === "siege" && <AppLink href={workshopHref} className={buttonVariants({ size: "sm" })}><Wrench />{t(($) => $.weapons.open_workshop)}</AppLink>}
    {filter === "tanks" && <AppLink href={garageHref} className={buttonVariants({ size: "sm" })}><Shield />{t(($) => $.weapons.open_garage)}</AppLink>}
  </CardContent></Card>;
}

function readLocalProgress(storage: StorageAdapter, userId: string, workspaceId: string): { stars: number[]; tanks: ReturnType<typeof parseTankPreferences> } {
  let stars: number[] = Array(CAMPAIGN_LEVELS.length).fill(0);
  let tanks = parseTankPreferences(null);
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
