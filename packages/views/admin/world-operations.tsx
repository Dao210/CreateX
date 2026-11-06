"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowLeft, ArrowRight, CalendarDays, Loader2, RefreshCw, Search } from "lucide-react";
import { paths } from "@auro/core/paths";
import { worldOpsDetailOptions, worldOpsOptions, type WorldOpsPage, type WorldOpsDetail } from "@auro/core/admin";
import { Button } from "@auro/ui/components/ui/button";
import { useT } from "../i18n";
import { AppLink, useNavigation } from "../navigation";
import { WorldFollowups } from "./world-followups";
import "./world-operations.css";

type Change = (changes: Record<string, string | null>) => void;
type TrendMetric = "new" | "visited" | "returning" | "active" | "creative";
const trendMetrics: TrendMetric[] = ["new", "visited", "returning", "active", "creative"];
const gameIds = ["siege", "tanks", "fish"] as const;
const adminWorlds = paths.admin("worlds");

function withQuery(path: string, query: URLSearchParams) {
  return query.size ? `${path}?${query}` : path;
}

function formatDay(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function formatInstant(date: string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(date));
}

function useWorldLabels() {
  const { t } = useT("admin");
  const { t: layout } = useT("layout");
  return {
    games: { siege: layout($ => $.nav.siege), tanks: layout($ => $.nav.tanks), fish: layout($ => $.nav.fish), life: layout($ => $.nav.life) },
    segments: {
      new: t($ => $.worlds.new), visited: t($ => $.worlds.visited), browsing: t($ => $.worlds.browsing),
      returning: t($ => $.worlds.returning), active: t($ => $.worlds.active), creative: t($ => $.worlds.creative),
      first: t($ => $.worlds.first), cohort: t($ => $.worlds.cohort), "no-visit": t($ => $.worlds.no_visit),
      "no-creation": t($ => $.worlds.no_creation), quiet: t($ => $.worlds.quiet), following: t($ => $.worlds.following),
      mine: t($ => $.worlds.mine),
    },
  };
}

function LoadState({ error, retry }: { error: boolean; retry: () => void }) {
  const { t } = useT("admin");
  return error ? <div className="admin-state" role="alert"><p>{t($ => $.load_error)}</p>
    <Button variant="outline" onClick={retry}>{t($ => $.refresh)}</Button></div>
    : <div className="admin-state" role="status"><Loader2 className="animate-spin" />{t($ => $.loading)}</div>;
}

function DateRange({ data, change }: { data: WorldOpsPage; change: Change }) {
  const { t } = useT("admin");
  const [from, setFrom] = useState(data.from);
  const [to, setTo] = useState(data.to);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: data.timeZone, dateStyle: "short" }).format(new Date());
  const preset = (days: number) => {
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days + 1);
    change({ from: start.toISOString().slice(0, 10), to: today, asOf: null });
  };
  return <form className="world-ops-toolbar" onSubmit={event => { event.preventDefault(); change({ from, to, asOf: null }); }}>
    <div className="world-ops-presets">
      <Button type="button" variant="outline" size="sm" onClick={() => preset(7)}>{t($ => $.worlds.last_week)}</Button>
      <Button type="button" variant="outline" size="sm" onClick={() => preset(30)}>{t($ => $.worlds.last_month)}</Button>
    </div>
    <label>{t($ => $.worlds.from)}<input type="date" required value={from} max={to} onChange={event => setFrom(event.target.value)} /></label>
    <label>{t($ => $.worlds.to)}<input type="date" required value={to} min={from} max={today} onChange={event => setTo(event.target.value)} /></label>
    <Button type="submit" size="sm" variant="secondary"><CalendarDays />{t($ => $.worlds.apply)}</Button>
  </form>;
}

function Coverage({ data }: { data: WorldOpsPage }) {
  const { t, i18n } = useT("admin");
  return <div className="world-ops-coverage">
    <span><time dateTime={data.from}>{formatDay(data.from, i18n.language)}</time> – <time dateTime={data.to}>{formatDay(data.to, i18n.language)}</time></span>
    <span>{t($ => $.worlds.coverage, { date: formatInstant(data.coverageStart, i18n.language, data.timeZone) })}</span>
    <span>{t($ => $.worlds.snapshot, { time: formatInstant(data.asOf, i18n.language, data.timeZone), zone: data.timeZone })}</span>
  </div>;
}

function Trend({ data, detail, select, selectedDay }: {
  data: WorldOpsPage;
  detail?: boolean;
  select?: (metric: TrendMetric, day: string) => void;
  selectedDay?: string | null;
}) {
  const { t, i18n } = useT("admin");
  const { segments } = useWorldLabels();
  const [metric, setMetric] = useState<TrendMetric>("visited");
  const options = detail ? trendMetrics.filter(item => item !== "new") : trendMetrics;
  const values = data.trend.map(point => detail ? (
    metric === "visited" ? point.visitors : metric === "returning" ? point.returnVisitors
      : metric === "active" ? point.members : point.creations
  ) : point[metric]);
  const peak = Math.max(1, ...values);
  const coverageDay = new Intl.DateTimeFormat("sv-SE", { timeZone: data.timeZone, dateStyle: "short" }).format(new Date(data.coverageStart));
  return <section className="admin-panel world-ops-trend" aria-label={t($ => $.worlds.trend)}>
    <div className="world-ops-panel-heading"><h3>{t($ => $.worlds.trend)}</h3>
      <label className="world-ops-inline">{t($ => $.worlds.metric)}
        <select value={metric} onChange={event => setMetric(event.target.value as TrendMetric)}>
          {options.map(value => <option key={value} value={value}>{detail
            ? value === "visited" ? t($ => $.worlds.visitors)
              : value === "returning" ? t($ => $.worlds.return_visitors)
                : value === "active" ? t($ => $.worlds.members_active) : t($ => $.worlds.works)
            : segments[value]}</option>)}
        </select>
      </label>
    </div>
    <div className="world-ops-plot" tabIndex={0} role="region" aria-label={t($ => $.worlds.trend)}>
      <div className="world-ops-columns" style={{ gridTemplateColumns: `repeat(${data.trend.length}, minmax(${data.trend.length > 31 ? 12 : 8}px, 1fr))` }}>
        {data.trend.map((point, index) => {
          const value = values[index] ?? 0;
          const missing = (metric === "returning" && data.coveredVisitDays < 2) ||
            (point.day < coverageDay && (metric === "visited" || (metric !== "new" && value === 0)));
          const label = `${formatDay(point.day, i18n.language)} · ${missing ? t($ => $.worlds.insufficient) : value.toLocaleString(i18n.language)}`;
          const bar = <span className="world-ops-bar" style={{ blockSize: value ? `${100 * value / peak}%` : undefined }} />;
          return select && value > 0 && !missing
            ? <button type="button" className="world-ops-column" key={point.day} title={label} aria-label={label}
                aria-pressed={selectedDay === point.day} onClick={() => select(metric, point.day)}>{bar}</button>
            : <span className={`world-ops-column${missing ? " world-ops-missing" : ""}`} key={point.day} title={label}>{bar}</span>;
        })}
      </div>
    </div>
    <div className="world-ops-axis">
      <time dateTime={data.from}>{formatDay(data.from, i18n.language)}</time>
      <time dateTime={data.to}>{formatDay(data.to, i18n.language)}</time>
    </div>
  </section>;
}

function GameBreakdown({ data, policies, game }: { data: WorldOpsPage; policies?: WorldOpsDetail["policies"]; game?: string }) {
  const { t, i18n } = useT("admin");
  const { games } = useWorldLabels();
  const ids = policies ? [...gameIds, "life" as const] : gameIds;
  const visible = game ? ids.filter(id => id === game) : ids;
  return <section className="admin-panel world-ops-games">
    <div className="world-ops-panel-heading"><h3>{t($ => $.worlds.by_game)}</h3></div>
    <div className="admin-table-scroll">
      <table className="admin-table world-ops-table"><thead><tr>
        <th>{t($ => $.worlds.game)}</th><th>{t($ => $.worlds.works)}</th><th>{t($ => $.worlds.works_total)}</th>
        <th>{t($ => $.worlds.manual)}</th><th>MCP</th><th>{t($ => $.worlds.unknown)}</th>{policies && <th>{t($ => $.worlds.current_access)}</th>}
      </tr></thead><tbody>{visible.map(game => {
        const row = data.games.find(item => item.game === game);
        const policy = policies?.find(item => item.gameId === game);
        return <tr key={game}><th scope="row">{games[game]}</th>
          {[row?.creations, row?.total, row?.manual, row?.mcp, row && row.creations - row.manual - row.mcp].map((value, index) =>
            <td key={index}>{game === "life" ? "—" : (value ?? 0).toLocaleString(i18n.language)}</td>)}
          {policies && <td>{policy ? <span className="admin-tag">{policy.available ? t($ => $.enabled) : t($ => $.disabled)}</span> : "—"}</td>}
        </tr>;
      })}</tbody></table>
    </div>
  </section>;
}

function WorldOverview({ userId, params, change }: { userId: string; params: URLSearchParams; change: Change }) {
  const { t, i18n } = useT("admin");
  const { segments, games } = useWorldLabels();
  const focus = params.get("focus");
  const apiParams = new URLSearchParams(params);
  apiParams.delete("focus");
  const query = useQuery(worldOpsOptions(userId, apiParams.toString()));
  const data = query.data;
  const querySearch = params.get("q") ?? "";
  const [search, setSearch] = useState(querySearch);
  useEffect(() => { setSearch(querySearch); }, [querySearch]);
  useEffect(() => {
    if (focus && data) document.getElementById(`world-ops-row-${focus}`)?.scrollIntoView({ block: "nearest" });
  }, [focus, data]);
  if (!data) return <LoadState error={query.isError} retry={() => { void query.refetch(); }} />;
  const { totals } = data;
  const activeSegment = params.get("segment") ?? "";
  const game = params.get("game") ?? "";
  const visitCount = data.coveredVisitDays ? totals.visited : null;
  const metrics = [
    { id: "", label: t($ => $.worlds.total), value: totals.total },
    { id: "new", label: segments.new, value: totals.new },
    { id: "visited", label: segments.visited, value: visitCount },
    { id: "browsing", label: segments.browsing, value: totals.covered && !game ? totals.browsing : null },
    { id: "returning", label: segments.returning, value: data.coveredVisitDays >= 2 ? totals.returning : null },
    { id: "active", label: segments.active, value: totals.active || totals.covered ? totals.active : null },
    { id: "creative", label: segments.creative, value: totals.creative || totals.covered ? totals.creative : null },
    { id: "first", label: t($ => $.worlds.first_rate), value: totals.cohort ? `${Math.round(100 * totals.first / totals.cohort)}%` : null },
  ];
  const currentPage = Number(params.get("page") ?? 0);
  const point = params.get("point");
  const snapshot = { from: data.from, to: data.to, asOf: data.asOf };
  const filter = (event: FormEvent) => {
    event.preventDefault();
    change({ ...snapshot, q: search.trim() || null });
  };
  const number = (value: number | string | null) => value === null ? "—" : value.toLocaleString(i18n.language);
  return <div className="admin-content world-ops">
    <div className="world-ops-top">
      <DateRange key={`${data.from}/${data.to}`} data={data} change={change} />
      <Button variant="ghost" size="sm" aria-label={t($ => $.refresh)} disabled={query.isFetching}
        onClick={() => { if (params.has("asOf")) change({ asOf: null }); else void query.refetch(); }}><RefreshCw /></Button>
    </div>
    <Coverage data={data} />
    <div className="world-ops-metrics">
      {metrics.map(({ id, label, value }) => <button type="button" key={id} className="world-ops-metric" aria-pressed={activeSegment === id && !point}
        disabled={value === null} onClick={() => change({ ...snapshot, segment: id || null, q: null })}>
        <span>{label}<ArrowDownRight size={14} /></span><strong>{number(value)}</strong>
        {value === null ? <small>{t($ => $.worlds.insufficient)}</small> : id === "first" &&
          <small>{totals.first.toLocaleString(i18n.language)} / {totals.cohort.toLocaleString(i18n.language)}</small>}
      </button>)}
    </div>
    <Trend data={data} selectedDay={point} select={(segment, day) => change({ ...snapshot, segment, point: day, q: null })} />
    <section className="admin-panel world-ops-list" aria-labelledby="world-ops-list-title">
      <div className="world-ops-panel-heading"><h3 id="world-ops-list-title">{t($ => $.worlds.list)}</h3><span>{data.matched.toLocaleString(i18n.language)}</span></div>
      <div className="world-ops-toolbar world-ops-filters">
        <form className="world-ops-search" onSubmit={filter}>
          <label>{t($ => $.worlds.search)}<input type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} /></label>
          <Button type="submit" size="icon-sm" variant="outline" aria-label={t($ => $.worlds.search)}><Search /></Button>
        </form>
        <label>{t($ => $.worlds.segment)}<select value={activeSegment} onChange={event => change({ ...snapshot, segment: event.target.value || null })}>
          <option value="">{t($ => $.worlds.all_worlds)}</option>
          {Object.entries(segments).map(([key, label]) => <option value={key} key={key} disabled={key === "browsing" && Boolean(game)}>{label}</option>)}
        </select></label>
        <label>{t($ => $.worlds.game)}<select value={game} onChange={event => change({
          ...snapshot, game: event.target.value || null, segment: activeSegment === "browsing" && event.target.value ? null : activeSegment || null,
        })}>
          <option value="">{t($ => $.worlds.all_games)}</option>
          {gameIds.map(id => <option value={id} key={id}>{games[id]}</option>)}
        </select></label>
        <Button variant="outline" size="sm" aria-pressed={activeSegment === "mine"} onClick={() => change({
          ...snapshot, segment: activeSegment === "mine" ? null : "mine",
        })}>{t($ => $.worlds.mine)}</Button>
      </div>
      {point && <div className="world-ops-point">
        <time dateTime={point}>{formatDay(point, i18n.language)}</time>
        <Button variant="ghost" size="sm" onClick={() => change({ point: null })}>{t($ => $.worlds.clear_day)}</Button>
      </div>}
      {data.items.length ? <div className="admin-table-scroll">
        <table className="admin-table world-ops-table"><thead><tr>
          {[t($ => $.worlds.world), t($ => $.worlds.created), t($ => $.worlds.members), t($ => $.worlds.visitors),
            t($ => $.worlds.members_active), t($ => $.worlds.works), t($ => $.worlds.last_action), t($ => $.worlds.followup)].map(label => <th key={label}>{label}</th>)}
        </tr></thead><tbody>{data.items.map(world => {
          const link = new URLSearchParams(apiParams);
          Object.entries(snapshot).forEach(([key, value]) => link.set(key, value));
          return <tr key={world.id} id={`world-ops-row-${world.id}`}>
            <td><AppLink href={withQuery(paths.adminWorld(world.id), link)}>{world.name}</AppLink><small>/{world.slug}</small></td>
            <td>{formatInstant(world.createdAt, i18n.language, data.timeZone)}</td>
            <td>{number(world.members)}</td><td>{number(visitCount === null ? null : world.visitors)}</td>
            <td>{number(world.covered || world.activeMembers ? world.activeMembers : null)}</td><td>{number(world.covered || world.creations ? world.creations : null)}</td>
            <td>{world.lastAction ? formatInstant(world.lastAction, i18n.language, data.timeZone) : "—"}</td>
            <td>{world.following ? <span className="admin-tag">{t($ => $.worlds.pending)}</span> : "—"}</td>
          </tr>;
        })}</tbody></table>
      </div> : <p className="world-ops-empty">{t($ => $.worlds.empty_worlds)}</p>}
      <div className="world-ops-pagination">
        <Button variant="outline" size="sm" disabled={!currentPage} onClick={() => change({ ...snapshot, page: String(currentPage - 1), point })}><ArrowLeft />{t($ => $.worlds.previous)}</Button>
        <Button variant="outline" size="sm" disabled={(currentPage + 1) * 25 >= data.matched} onClick={() => change({ ...snapshot, page: String(currentPage + 1), point })}>{t($ => $.worlds.next)}<ArrowRight /></Button>
      </div>
    </section>
    <GameBreakdown data={data} game={game} />
  </div>;
}

function WorldDetail({ userId, worldId, params }: { userId: string; worldId: string; params: URLSearchParams }) {
  const { t, i18n } = useT("admin");
  const { games } = useWorldLabels();
  const read = new URLSearchParams();
  for (const key of ["from", "to", "game", "asOf"]) {
    const value = params.get(key);
    if (value) read.set(key, value);
  }
  const query = useQuery(worldOpsDetailOptions(userId, worldId, read.toString()));
  const back = new URLSearchParams(params);
  back.set("focus", worldId);
  const data = query.data;
  const world = data?.items[0];
  const actions = { creation: t($ => $.worlds.creation), revision: t($ => $.worlds.revision), release: t($ => $.worlds.release), progress: t($ => $.worlds.progress) };
  const origins = { manual: t($ => $.worlds.manual), mcp: "MCP", unknown: t($ => $.worlds.unknown) };
  return <div className="admin-content world-ops">
    <AppLink href={withQuery(adminWorlds, back)} className="world-ops-back"><ArrowLeft size={16} />{t($ => $.worlds.back)}</AppLink>
    {data && world ? <>
      <div className="world-ops-world">
        <div><h2>{world.name}</h2><p>/{world.slug} · {t($ => $.worlds.created)} {formatInstant(world.createdAt, i18n.language, data.timeZone)}</p></div>
        <div className="world-ops-links"><AppLink href={paths.admin("games")}>{t($ => $.games_title)}<ArrowDownRight size={14} /></AppLink>
          <AppLink href={paths.admin("mcp")}>{t($ => $.mcp)}<ArrowDownRight size={14} /></AppLink></div>
      </div>
      <Coverage data={data} />
      <dl className="world-ops-metrics world-ops-detail-metrics">
        {([
          [t($ => $.worlds.members), world.members, null],
          [t($ => $.worlds.visitors), data.coveredVisitDays ? world.visitors : null, null],
          [t($ => $.worlds.return_rate), data.coveredVisitDays >= 2 && world.visitors ? `${Math.round(100 * world.returning / world.visitors)}%` : null,
            data.coveredVisitDays >= 2 && world.visitors ? `${world.returning} / ${world.visitors}` : null],
          [t($ => $.worlds.members_active), world.covered || world.activeMembers ? world.activeMembers : null,
            world.covered && world.previousCovered ? t($ => $.worlds.previous_value, { count: world.priorMembers }) : null],
          [t($ => $.worlds.works), world.covered || world.creations ? world.creations : null,
            world.covered && world.previousCovered ? t($ => $.worlds.previous_value, { count: world.priorCreations }) : null],
        ] as const).map(([label, value, hint]) => <div className="world-ops-metric" key={label}>
          <dt>{label}</dt><dd><strong>{value === null ? "—" : value.toLocaleString(i18n.language)}</strong>
          <small>{value === null ? t($ => $.worlds.insufficient) : hint}</small></dd>
        </div>)}
      </dl>
      <WorldFollowups userId={userId} worldId={worldId} />
      <Trend data={data} detail />
      <GameBreakdown data={data} policies={data.policies} game={read.get("game") ?? undefined} />
      <section className="admin-panel world-ops-activity">
        <div className="world-ops-panel-heading"><h3>{t($ => $.worlds.activity)}</h3></div>
        <div className="world-ops-diagnostics">
          <span>{t($ => $.worlds.first_saved)} <strong>{world.firstCreation ? formatInstant(world.firstCreation, i18n.language, data.timeZone) : "—"}</strong></span>
          <span>{t($ => $.worlds.mcp_summary, { count: data.diagnostics.calls, failed: data.diagnostics.failed })}</span>
          <span>{data.diagnostics.simulation_bound ? t($ => $.worlds.simulation_count, { count: data.diagnostics.simulation_events }) : t($ => $.worlds.no_simulation)}</span>
        </div>
        {data.activity.length ? <ol className="world-ops-events">{data.activity.map((item, index) =>
          <li key={`${item.occurredAt}/${index}`}><time dateTime={item.occurredAt}>{formatInstant(item.occurredAt, i18n.language, data.timeZone)}</time>
            <strong>{games[item.game as keyof typeof games] ?? item.game}</strong><span>{actions[item.kind]}</span><span className="admin-tag">{origins[item.origin]}</span>
          </li>)}</ol> : <p className="world-ops-empty">{t($ => $.worlds.empty_events)}</p>}
      </section>
    </> : <LoadState error={query.isError} retry={() => { void query.refetch(); }} />}
  </div>;
}

export function WorldOperations({ userId, worldId, worldQuery }: { userId: string; worldId?: string; worldQuery?: string }) {
  const navigation = useNavigation();
  const rawQuery = worldQuery ?? navigation.searchParams.toString();
  const params = new URLSearchParams(rawQuery);
  const change: Change = changes => {
    const next = new URLSearchParams(rawQuery);
    next.delete("focus");
    next.delete("point");
    next.delete("page");
    for (const [key, value] of Object.entries(changes)) {
      if (value !== null) next.set(key, value);
      else next.delete(key);
    }
    navigation.push(withQuery(adminWorlds, next));
  };
  return worldId ? <WorldDetail key={worldId} userId={userId} worldId={worldId} params={params} />
    : <WorldOverview userId={userId} params={params} change={change} />;
}
