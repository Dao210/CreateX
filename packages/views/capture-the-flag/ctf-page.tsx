"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Flag,
  Download,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Maximize2,
  ArrowLeftRight,
  Trophy,
} from "lucide-react";
import {
  TrialMessageSchema,
  type TrialResult,
  newMatch,
  tickMatch,
  frameOf,
  makeBaselineStrategy,
  ctfStateOptions,
  ctfMatchOptions,
  useCTFActions,
  useCTFStrategyLoader,
  GAME_VERSION,
  type Frame,
  type Match,
  type Strategy,
  type StrategySummary,
  type StrategyRecord,
} from "@auro/core/capture-the-flag";
import { authenticatedFetch } from "@auro/core/api";
import { useCurrentWorkspace, useWorkspacePaths } from "@auro/core/paths";
import { useAuthStore } from "@auro/core/auth";
import { Button, buttonVariants } from "@auro/ui/components/ui/button";
import { Input } from "@auro/ui/components/ui/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@auro/ui/components/ui/dialog";
import { useT } from "../i18n";
import { AppLink, useNavigation } from "../navigation";
import { GameAccessBoundary } from "../admin/game-access-boundary";
import { BattleView, battleTime } from "./battle-view";
import { CTFReference } from "./ctf-reference";
import { StrategySummary as StrategySummaryView } from "./strategy-summary";
import { StrategyImportDialog } from "./strategy-import-dialog";

function download(name: string, body: Blob) {
  const url = URL.createObjectURL(body);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const baseline = () =>
  makeBaselineStrategy("my_strategy", "My strategy", "red");

export function CTFPage() {
  const ws = useCurrentWorkspace(),
    user = useAuthStore((s) => s.user);
  if (!ws || !user) return null;
  return (
    <GameAccessBoundary gameId="ctf">
      <Content key={`${ws.id}:${user.id}`} wsId={ws.id} userId={user.id} />
    </GameAccessBoundary>
  );
}
type LocalReview = {
  frames: Frame[];
  redName: string;
  blueName: string;
  seed: number;
  result: Frame["result"];
};

function Content({ wsId, userId }: { wsId: string; userId: string }) {
  const { t } = useT("ctf");
  const paths = useWorkspacePaths(),
    navigation = useNavigation();
  const root = paths.ctf(),
    isArena = navigation.pathname === `${root}/arena`;
  const matchId = navigation.pathname.startsWith(`${root}/matches/`)
    ? navigation.pathname.slice(`${root}/matches/`.length)
    : "";
  const loadStrategy = useCTFStrategyLoader(wsId, userId);
  const state = useQuery(ctfStateOptions(wsId, userId));
  const actions = useCTFActions(wsId);
  const matchQuery = useQuery(ctfMatchOptions(wsId, matchId));
  const trialWorker = useRef<Worker | null>(null),
    trialGeneration = useRef(0);
  const [trialRunning, setTrialRunning] = useState(false),
    [trialResults, setTrialResults] = useState<TrialResult[]>([]);
  const stopTrial = useCallback(() => {
    trialGeneration.current++;
    trialWorker.current?.terminate();
    trialWorker.current = null;
    setTrialRunning(false);
  }, []);
  useEffect(
    () => () => {
      trialGeneration.current++;
      trialWorker.current?.terminate();
    },
    [],
  );
  const [sourceLoading, setSourceLoading] = useState(false);
  const generations = useRef({ red: 0, blue: 0 });
  const [notice, setNotice] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("red_archer");
  const [localReview, setLocalReview] = useState<LocalReview | null>(null);
  const trialChallenger = useRef("");
  const [trialTotal, setTrialTotal] = useState(0);
  const [red, setRed] = useState<Strategy>(() => baseline());
  const [blue, setBlue] = useState<Strategy>(() =>
    makeBaselineStrategy("opponent", "Baseline", "blue"),
  );
  const [redKey, setRedKey] = useState("baseline"),
    [blueKey, setBlueKey] = useState("baseline");
  const [redLabel, setRedLabel] = useState(t(($) => $.baseline));
  const [blueLabel, setBlueLabel] = useState(t(($) => $.baseline));
  const strategyPanel = useRef<HTMLElement>(null);
  const [seed, setSeed] = useState(12027),
    [speed, setSpeed] = useState(1),
    [running, setRunning] = useState(false);
  const [initialMatch] = useState(() => newMatch(seed, { red, blue }));
  const engine = useRef<Match>(initialMatch);
  const [frame, setFrame] = useState<Frame>(() => frameOf(engine.current));
  const localRecording = useRef<Frame[]>([frame]);
  const liveTimeline = useMemo(
    () =>
      localRecording.current.at(-1)?.tick === frame.tick
        ? localRecording.current.slice()
        : [...localRecording.current, frame],
    [frame],
  );
  const [recordingIndex, setRecordingIndex] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [enrolling, setEnrolling] = useState<StrategySummary | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const request = useRef<{ key: string; id: string } | null>(null),
    startRequest = useRef<string | null>(null);
  const entry = state.data?.entries.find((e) => e.ownerId === userId);
  const choices = useMemo(() => {
    const unique = new Map<string, StrategySummary>();
    for (const c of [
      ...(state.data?.mine ?? []),
      ...(state.data?.library ?? []),
    ])
      if (!c.archived) unique.set(`${c.id}:${c.revision}`, c);
    return [...unique.values()];
  }, [state.data]);
  const reset = useCallback(
    (nextRed = red, nextBlue = blue, nextSeed = seed) => {
      setRunning(false);
      engine.current = newMatch(nextSeed, { red: nextRed, blue: nextBlue });
      const next = frameOf(engine.current);
      localRecording.current = [next];
      setLocalReview(null);
      setFrame(next);
    },
    [red, blue, seed],
  );
  const advance = () => {
    tickMatch(engine.current, { headless: true });
    const next = frameOf(engine.current);
    if (
      (next.tick % 4 === 0 || next.result) &&
      localRecording.current.at(-1)?.tick !== next.tick
    )
      localRecording.current.push(next);
    return next;
  };
  const step = () => {
    setFrame(advance());
    if (engine.current.result) setRunning(false);
  };
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      let next = frameOf(engine.current);
      for (let i = 0; i < Math.max(1, speed); i++) next = advance();
      setFrame(next);
      if (engine.current.result) setRunning(false);
    }, 250);
    return () => clearInterval(timer);
  }, [running, speed]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        setRunning(false);
        setReplaying(false);
      }
    };
    const fullscreen = () => {
      if (!document.fullscreenElement) {
        setRunning(false);
        setReplaying(false);
      }
    };
    document.addEventListener("visibilitychange", pause);
    document.addEventListener("fullscreenchange", fullscreen);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      document.removeEventListener("fullscreenchange", fullscreen);
    };
  }, []);
  const choose = useCallback(
    async (side: "red" | "blue", key: string) => {
      const generation = ++generations.current[side];
      const choice = choices.find((s) => `${s.id}:${s.revision}` === key);
      setSourceLoading(true);
      try {
        const strategy = choice
          ? (await loadStrategy(choice.id, choice.revision)).strategy
          : makeBaselineStrategy(
              side,
              t(($) => $.baseline),
              side,
            );
        if (generation !== generations.current[side]) return;
        if (side === "red") {
          stopTrial();
          setTrialResults([]);
          setTrialTotal(0);
          setRed(strategy);
          setRedLabel(choice?.name ?? t(($) => $.baseline));
          setRedKey(key);
          reset(strategy, blue);
        } else {
          setBlue(strategy);
          setBlueLabel(choice?.name ?? t(($) => $.baseline));
          setBlueKey(key);
          reset(red, strategy);
        }
      } finally {
        if (generation === generations.current[side]) setSourceLoading(false);
      }
    },
    [choices, loadStrategy, t, reset, red, blue, stopTrial],
  );
  const loaded = useRef("");
  useEffect(() => {
    const selected = navigation.searchParams.get("strategy");
    if (!selected || loaded.current === selected) return;
    const record = state.data?.mine.find((s) => s.id === selected);
    if (!record) return;
    loaded.current = selected;
    void choose("red", `${record.id}:${record.revision}`).catch(() =>
      setNotice(t(($) => $.error)),
    );
  }, [navigation.searchParams, state.data, choose, t]);
  useEffect(() => {
    stopTrial();
    setRunning(false);
    setReplaying(false);
    setRecordingIndex(0);
    setLocalReview(null);
  }, [isArena, matchId, stopTrial]);
  const recorded = useMemo(
    () =>
      matchId ? (matchQuery.data?.frames ?? []) : (localReview?.frames ?? []),
    [matchId, matchQuery.data?.frames, localReview],
  );
  useEffect(() => {
    if (!replaying || recorded.length < 2) return;
    if (recordingIndex >= recorded.length - 1) {
      setReplaying(false);
      return;
    }
    const current = recorded[recordingIndex]!,
      next = recorded[recordingIndex + 1]!;
    const timer = setTimeout(
      () => setRecordingIndex((i) => i + 1),
      Math.max(16, ((next.time - current.time) * 1000) / speed),
    );
    return () => clearTimeout(timer);
  }, [replaying, recorded, recordingIndex, speed]);
  const status = (value: string) => {
    switch (value) {
      case "running":
        return t(($) => $.running);
      case "queued":
        return t(($) => $.queued);
      case "paused":
        return t(($) => $.paused);
      case "stopped":
        return t(($) => $.stopped);
      case "completed":
        return t(($) => $.completed);
      case "failed":
        return t(($) => $.failed);
      default:
        return t(($) => $.unknown);
    }
  };
  const outcome = (value?: string) =>
    value === "red"
      ? t(($) => $.redWin)
      : value === "blue"
        ? t(($) => $.blueWin)
        : value === "draw"
          ? t(($) => $.draw)
          : t(($) => $.unknown);
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      setNotice("");
      await fn();
      return true;
    } catch (e) {
      setNotice(
        e instanceof Error && e.message === "no_new_pairs"
          ? t(($) => $.noNewPairs)
          : e instanceof Error && e.message === "revision_conflict"
            ? t(($) => $.conflict)
            : t(($) => $.error),
      );
      return false;
    }
  };
  const runTrials = async () => {
    const challenger = red;
    stopTrial();
    setRunning(false);
    setTrialResults([]);
    setTrialTotal(0);
    trialChallenger.current = redLabel;
    setTrialRunning(true);
    const generation = trialGeneration.current;
    try {
      const candidates = (state.data?.library ?? [])
        .filter((c) => c.ownerId !== userId)
        .slice(0, 48);
      const opponents: { name: string; strategy: Strategy }[] = [];
      for (let i = 0; i < candidates.length; i += 4) {
        const group = await Promise.all(
          candidates.slice(i, i + 4).map(async (c) => ({
            name: c.name,
            strategy: (await loadStrategy(c.id, c.revision)).strategy,
          })),
        );
        if (generation !== trialGeneration.current) return;
        opponents.push(...group);
      }
      if (!opponents.length)
        opponents.push({
          name: t(($) => $.baseline),
          strategy: makeBaselineStrategy("baseline", "Baseline", "blue"),
        });
      setTrialTotal(opponents.length);
      const worker = new Worker(new URL("./trial.worker.ts", import.meta.url), {
        type: "module",
      });
      trialWorker.current = worker;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (generation !== trialGeneration.current) return;
        const message = TrialMessageSchema.safeParse(event.data);
        if (!message.success || message.data.kind === "error") {
          setNotice(t(($) => $.error));
          stopTrial();
          return;
        }
        if (message.data.kind === "done") {
          stopTrial();
          return;
        }
        const result = message.data;
        setTrialResults((rows) => [...rows, result]);
      };
      worker.onerror = () => {
        setNotice(t(($) => $.error));
        stopTrial();
      };
      worker.postMessage({ seed, challenger, opponents });
    } catch {
      if (generation === trialGeneration.current) {
        setNotice(t(($) => $.error));
        stopTrial();
      }
    }
  };
  const imported = (record: StrategyRecord) => {
    generations.current.red++;
    stopTrial();
    setTrialResults([]);
    setTrialTotal(0);
    setSourceLoading(false);
    setRed(record.strategy);
    setRedLabel(record.name);
    setRedKey(`${record.id}:${record.revision}`);
    reset(record.strategy, blue);
    setNotice(t(($) => $.saved));
  };
  const load = (record: StrategySummary) => {
    void attempt(async () => {
      await choose("red", `${record.id}:${record.revision}`);
      strategyPanel.current?.scrollIntoView({ block: "nearest" });
    });
  };
  const busy =
    sourceLoading ||
    actions.save.isPending ||
    actions.enroll.isPending ||
    actions.start.isPending ||
    actions.control.isPending;
  const active = state.data?.batches.find(
    (b) => b.status === "running" || b.status === "paused",
  );
  const shown =
    matchId || localReview
      ? recorded[Math.min(recordingIndex, recorded.length - 1)]
      : frame;
  const enhancementName = (strategy: Strategy) => {
    const mode = strategy.enhancement_mode ?? "standard";
    return mode === "standard"
      ? t(($) => $.tactics.standard)
      : t(($) => $[mode]);
  };
  const review = localReview
    ? {
        ...localReview,
        status: localReview.result ? "completed" : "paused",
        red: { ownerName: t(($) => $.red), name: localReview.redName },
        blue: { ownerName: t(($) => $.blue), name: localReview.blueName },
      }
    : matchQuery.data;
  const seek = (index: number) => {
    setReplaying(false);
    setSpeed((value) => Math.min(value, 10));
    setRecordingIndex(index);
  };
  return (
    <Dialog
      open={confirmOpen}
      onOpenChange={(open) => {
        if (!actions.enroll.isPending) setConfirmOpen(open);
      }}
    >
      <div className="ctf-page">
        <header className="ctf-header">
          <div className="ctf-brand">
            <Flag aria-hidden />
            <h1>{t(($) => $.title)}</h1>
            <span>{t(($) => $.ruleVersion, { version: GAME_VERSION })}</span>
          </div>
          <div className="ctf-header-actions">
            <CTFReference />
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void attempt(async () => {
                  const response = await authenticatedFetch(
                    "/api/ctf/v1/rule-kit.zip",
                    {
                      headers: {
                        "X-Workspace-ID": wsId,
                        "X-Workspace-Slug": "",
                      },
                    },
                  );
                  if (!response.ok) throw new Error("download_failed");
                  download("ctf-rules.zip", await response.blob());
                })
              }
            >
              <Download />
              {t(($) => $.rules)}
            </Button>
            {!matchId && (
              <StrategyImportDialog
                disabled={busy}
                onSave={actions.save.mutateAsync}
                onSaved={imported}
              />
            )}
            <AppLink
              href={`${paths.me()}?filter=ctf`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              {t(($) => $.myCreations)}
            </AppLink>
          </div>
        </header>
        <nav className="ctf-nav" aria-label={t(($) => $.title)}>
          <AppLink
            aria-current={!isArena && !matchId ? "page" : undefined}
            href={root}
          >
            {t(($) => $.trial)}
          </AppLink>
          <AppLink
            aria-current={isArena ? "page" : undefined}
            href={`${root}/arena`}
          >
            {t(($) => $.arena)}
          </AppLink>
          {matchId && <span>{t(($) => $.replay)}</span>}
        </nav>
        <main className="ctf-scroll">
          {notice && !confirmOpen && (
            <p role="status" className="ctf-notice">
              {notice}
            </p>
          )}
          {state.isError && (
            <div role="alert" className="ctf-notice">
              {t(($) => $.error)}
              <Button size="sm" onClick={() => void state.refetch()}>
                {t(($) => $.retry)}
              </Button>
            </div>
          )}
          {matchId || localReview ? (
            <section className="ctf-match">
              {matchId && matchQuery.isPending && (
                <p role="status">{t(($) => $.loading)}</p>
              )}
              {matchId && matchQuery.isError && (
                <p role="alert">
                  {t(($) => $.error)}
                  <Button onClick={() => void matchQuery.refetch()}>
                    {t(($) => $.retry)}
                  </Button>
                </p>
              )}
              {review && (
                <>
                  <div className="ctf-matchup">
                    <strong>
                      {review.red.ownerName} · {review.red.name}
                    </strong>
                    <span>{status(review.status)}</span>
                    <strong>
                      {review.blue.ownerName} · {review.blue.name}
                    </strong>
                  </div>
                  {shown ? (
                    <BattleView
                      frame={shown}
                      selectedId={selectedUnit}
                      onSelect={setSelectedUnit}
                      playing={replaying}
                      interval={
                        (Math.max(
                          0.25,
                          (recorded[recordingIndex]?.time ?? 1) -
                            (recorded[Math.max(0, recordingIndex - 1)]?.time ??
                              0),
                        ) *
                          1000) /
                        speed
                      }
                      timeline={recorded}
                      onSeek={seek}
                      stageMeta={
                        <div className="ctf-stage-meta">
                          <span>{battleTime(shown.time)}</span>
                          <span>
                            {!localReview &&
                            (review.status === "running" ||
                              review.status === "queued")
                              ? t(($) => $.tactics.computing)
                              : t(($) => $.replay)}{" "}
                            ·{" "}
                            {localReview
                              ? t(($) => $.tactics.localOnly)
                              : t(($) => $.arena)}
                          </span>
                          <span>
                            {t(($) => $.seed)} {review.seed}
                          </span>
                        </div>
                      }
                      controls={
                        <div className="ctf-controls ctf-replay-controls">
                          <Button
                            disabled={recorded.length < 2}
                            onClick={() => {
                              if (recordingIndex >= recorded.length - 1)
                                setRecordingIndex(0);
                              setReplaying(!replaying);
                            }}
                          >
                            {replaying ? <Pause /> : <Play />}
                            {replaying ? t(($) => $.pause) : t(($) => $.replay)}
                          </Button>
                          <input
                            type="range"
                            min="0"
                            max={Math.max(0, recorded.length - 1)}
                            value={recordingIndex}
                            aria-label={t(($) => $.replay)}
                            onChange={(e) => {
                              setReplaying(false);
                              setRecordingIndex(Number(e.target.value));
                            }}
                          />
                          <span>
                            {review.result
                              ? outcome(review.result.winner)
                              : status(review.status)}
                            {review.result && (
                              <small>{review.result.method}</small>
                            )}
                          </span>
                          <select
                            aria-label={t(($) => $.speed)}
                            value={speed}
                            onChange={(e) => setSpeed(Number(e.target.value))}
                          >
                            {[1, 2, 5, 10].map((value) => (
                              <option key={value} value={value}>
                                {value}×
                              </option>
                            ))}
                          </select>
                          {localReview && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setLocalReview(null);
                                setReplaying(false);
                              }}
                            >
                              {t(($) => $.tactics.exitReplay)}
                            </Button>
                          )}
                        </div>
                      }
                    />
                  ) : (
                    <p className="ctf-empty">{t(($) => $.emptyFrames)}</p>
                  )}
                </>
              )}
            </section>
          ) : !isArena ? (
            <>
              <div className="ctf-matchup ctf-trial-matchup">
                <div className="ctf-clock">
                  <strong>{battleTime(frame.time)}</strong>
                  <span>
                    {frame.result
                      ? outcome(frame.result.winner)
                      : running
                        ? t(($) => $.running)
                        : t(($) => $.paused)}
                  </span>
                </div>
                {(["red", "blue"] as const).map((side) => (
                  <div key={side} className={`ctf-matchup-slot ctf-${side}`}>
                    <label className={`ctf-side ctf-${side}`}>
                      <span>
                        {side === "red" ? t(($) => $.red) : t(($) => $.blue)}
                      </span>
                      <select
                        aria-label={t(($) => $[side])}
                        disabled={sourceLoading}
                        value={side === "red" ? redKey : blueKey}
                        onChange={(e) =>
                          void attempt(() => choose(side, e.target.value))
                        }
                      >
                        <option value="baseline">{t(($) => $.baseline)}</option>
                        {(side === "red" ? redKey : blueKey) !== "baseline" &&
                          !choices.some(
                            (s) =>
                              `${s.id}:${s.revision}` ===
                              (side === "red" ? redKey : blueKey),
                          ) && (
                            <option value={side === "red" ? redKey : blueKey}>
                              {side === "red" ? redLabel : blueLabel}
                            </option>
                          )}
                        {choices.map((s) => (
                          <option
                            key={`${s.id}:${s.revision}`}
                            value={`${s.id}:${s.revision}`}
                          >
                            {s.ownerName} · {s.name} ·{" "}
                            {t(($) => $.revision, { revision: s.revision })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <small>
                      {t(($) => $.tactics.enhancement)} ·{" "}
                      {enhancementName(side === "red" ? red : blue)}
                    </small>
                  </div>
                ))}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t(($) => $.swap)}
                  onClick={() => {
                    stopTrial();
                    setTrialResults([]);
                    setTrialTotal(0);
                    setRed(blue);
                    setBlue(red);
                    setRedLabel(blueLabel);
                    setBlueLabel(redLabel);
                    setRedKey(blueKey);
                    setBlueKey(redKey);
                    reset(blue, red);
                  }}
                >
                  <ArrowLeftRight />
                </Button>
              </div>
              <BattleView
                frame={frame}
                selectedId={selectedUnit}
                onSelect={setSelectedUnit}
                playing={running}
                stageRef={stage}
                timeline={liveTimeline}
                onSeek={(index) => {
                  setRunning(false);
                  setLocalReview({
                    frames: liveTimeline,
                    redName: redLabel,
                    blueName: blueLabel,
                    seed,
                    result: frame.result,
                  });
                  seek(index);
                }}
                stageMeta={
                  <div className="ctf-stage-meta">
                    <span>
                      {Math.floor(frame.time / 60)
                        .toString()
                        .padStart(2, "0")}
                      :
                      {Math.floor(frame.time % 60)
                        .toString()
                        .padStart(2, "0")}
                    </span>
                    <span>
                      {frame.result
                        ? outcome(frame.result.winner)
                        : `${frame.tick} / 1920`}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t(($) => $.fullscreen)}
                      onClick={() =>
                        void attempt(async () => {
                          if (document.fullscreenElement)
                            await document.exitFullscreen();
                          else await stage.current?.requestFullscreen();
                        })
                      }
                    >
                      <Maximize2 />
                    </Button>
                  </div>
                }
                controls={
                  <div className="ctf-controls">
                    <Button
                      disabled={!!frame.result}
                      onClick={() => setRunning(!running)}
                    >
                      {running ? <Pause /> : <Play />}
                      {running ? t(($) => $.pause) : t(($) => $.start)}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={running || !!frame.result}
                      onClick={step}
                    >
                      <SkipForward />
                      {t(($) => $.step)}
                    </Button>
                    <Button variant="ghost" onClick={() => reset()}>
                      <RotateCcw />
                      {t(($) => $.reset)}
                    </Button>
                    <label>
                      {t(($) => $.speed)}
                      <select
                        aria-label={t(($) => $.speed)}
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                      >
                        {[1, 2, 5, 10, 30, 100].map((s) => (
                          <option key={s} value={s}>
                            {s}×
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t(($) => $.seed)}
                      <Input
                        type="number"
                        min="0"
                        max="4294967295"
                        value={seed}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          if (
                            Number.isInteger(next) &&
                            next >= 0 &&
                            next <= 0xffffffff
                          ) {
                            setSeed(next);
                            reset(red, blue, next);
                          }
                        }}
                      />
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        strategyPanel.current?.scrollIntoView({
                          block: "nearest",
                        })
                      }
                    >
                      {t(($) => $.files.viewStrategy)}
                    </Button>
                  </div>
                }
              />
              <section
                className="ctf-strategy-panel"
                ref={strategyPanel}
                aria-label={t(($) => $.files.currentStrategy)}
              >
                <div className="ctf-section-head">
                  <div>
                    <h2>{t(($) => $.files.currentStrategy)}</h2>
                    <strong>{redLabel}</strong>
                    {redKey !== "baseline" && (
                      <span className="ctf-active-revision">
                        {t(($) => $.revision, {
                          revision: Number(redKey.split(":").at(-1)),
                        })}
                      </span>
                    )}
                  </div>
                  <div className="ctf-strategy-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        download(
                          `${redLabel}.strategy`,
                          new Blob([JSON.stringify(red, null, 2)], {
                            type: "application/json",
                          }),
                        )
                      }
                    >
                      <Download />
                      {t(($) => $.source)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void attempt(() => choose("red", "baseline"))
                      }
                    >
                      {t(($) => $.files.useExample)}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sourceLoading || trialRunning}
                      onClick={() => void runTrials()}
                    >
                      {t(($) => $.batchTrial)}
                    </Button>
                    {trialRunning && (
                      <Button size="sm" variant="ghost" onClick={stopTrial}>
                        {t(($) => $.stopTrial)}
                      </Button>
                    )}
                  </div>
                </div>
                <StrategySummaryView strategy={red} />
                {(trialRunning || trialResults.length > 0) && (
                  <div className="ctf-trial-progress">
                    <span>
                      {t(($) => $.tactics.trialProgress, {
                        done: trialResults.length,
                        total: trialTotal,
                      })}
                    </span>
                    <progress
                      max={Math.max(1, trialTotal)}
                      value={trialResults.length}
                    />
                  </div>
                )}
                {trialResults.length > 0 && (
                  <section className="ctf-trial-results">
                    <h2>{t(($) => $.trialResults)}</h2>
                    <div className="ctf-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{t(($) => $.tactics.opponent)}</th>
                            <th>{t(($) => $.seed)}</th>
                            <th>{t(($) => $.tactics.result)}</th>
                            <th>{t(($) => $.tactics.reason)}</th>
                            <th>{t(($) => $.tactics.simulationTime)}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {trialResults.map((row) => (
                            <tr key={row.index}>
                              <td>{row.name}</td>
                              <td>{row.seed}</td>
                              <td>{outcome(row.result.winner)}</td>
                              <td>{row.result.method}</td>
                              <td>{battleTime(row.duration)}</td>
                              <td>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={
                                    trialRunning || row.frames.length < 2
                                  }
                                  onClick={() => {
                                    setRunning(false);
                                    setLocalReview({
                                      frames: row.frames,
                                      redName: trialChallenger.current,
                                      blueName: row.name,
                                      seed: row.seed,
                                      result: row.result,
                                    });
                                    seek(0);
                                  }}
                                >
                                  {t(($) => $.tactics.inspectTrial)}
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </section>
            </>
          ) : (
            <>
              <section className="ctf-arena-top">
                <div>
                  <h2>
                    <Trophy />
                    {t(($) => $.arena)}
                  </h2>
                  <p>{t(($) => $.manageHelp)}</p>
                </div>
                {state.data?.canManage && (
                  <Button
                    disabled={
                      busy || !!active || (state.data?.entries.length ?? 0) < 2
                    }
                    onClick={() =>
                      void attempt(async () => {
                        startRequest.current ??= crypto.randomUUID();
                        await actions.start.mutateAsync(startRequest.current);
                        startRequest.current = null;
                      })
                    }
                  >
                    {t(($) => $.startBatch)}
                  </Button>
                )}
              </section>
              {entry && (
                <div className="ctf-entry">
                  <strong>{t(($) => $.enrolled)}</strong>
                  <span>
                    {entry.name} ·{" "}
                    {t(($) => $.revision, { revision: entry.revision })}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actions.withdraw.isPending}
                    onClick={() =>
                      void attempt(() => actions.withdraw.mutateAsync())
                    }
                  >
                    {t(($) => $.withdraw)}
                  </Button>
                </div>
              )}
              <section className="ctf-section">
                <h2>
                  {t(($) => $.entries)} · {state.data?.entries.length ?? 0}
                </h2>
                {(state.data?.entries.length ?? 0) < 2 && (
                  <p>{t(($) => $.emptyEntries)}</p>
                )}
                <div className="ctf-cards">
                  {state.data?.entries.map((s) => (
                    <article key={s.ownerId}>
                      <strong>{s.ownerName}</strong>
                      <span>
                        {s.name} ·{" "}
                        {t(($) => $.revision, { revision: s.revision })}
                      </span>
                    </article>
                  ))}
                </div>
              </section>
              {state.data?.batches.map((b) => (
                <div key={b.id} className="ctf-batch">
                  <time>{new Date(b.createdAt).toLocaleString()}</time>
                  <strong>{status(b.status)}</strong>
                  <span>
                    {b.completed} / {b.total}
                  </span>
                  {state.data?.canManage && (
                    <div>
                      {(b.status === "running" || b.status === "paused") && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void attempt(() =>
                                actions.control.mutateAsync({
                                  id: b.id,
                                  action:
                                    b.status === "paused" ? "resume" : "pause",
                                }),
                              )
                            }
                          >
                            {b.status === "paused"
                              ? t(($) => $.resume)
                              : t(($) => $.pause)}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void attempt(() =>
                                actions.control.mutateAsync({
                                  id: b.id,
                                  action: "stop",
                                }),
                              )
                            }
                          >
                            {t(($) => $.stop)}
                          </Button>
                        </>
                      )}
                      {(b.status === "stopped" || b.status === "completed") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void attempt(() =>
                              actions.control.mutateAsync({
                                id: b.id,
                                action: "publish",
                              }),
                            )
                          }
                        >
                          {t(($) => $.publish)}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <section className="ctf-section">
                <h2>{t(($) => $.leaderboard)}</h2>
                {!state.data?.leaderboard.length ? (
                  <p className="ctf-empty">{t(($) => $.emptyBoard)}</p>
                ) : (
                  <div className="ctf-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th aria-label={t(($) => $.leaderboard)}>#</th>
                          <th>{t(($) => $.strategyName)}</th>
                          <th>{t(($) => $.rating)}</th>
                          <th>{t(($) => $.games)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.data.leaderboard.map((row) => (
                          <tr key={row.strategy_id}>
                            <td>{row.rank}</td>
                            <td>
                              {row.strategy_name}
                              <small>
                                {t(($) => $.revision, {
                                  revision: row.revision,
                                })}
                              </small>
                              {row.provisional && (
                                <small>{t(($) => $.provisional)}</small>
                              )}
                            </td>
                            <td>{row.conservative_rating.toFixed(0)}</td>
                            <td>
                              {row.games} · {row.wins}/{row.draws}/{row.losses}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="ctf-section">
                <h2>{t(($) => $.history)}</h2>
                {!state.data?.matches.length && (
                  <p>{t(($) => $.emptyHistory)}</p>
                )}
                <div className="ctf-table-scroll">
                  <table>
                    <tbody>
                      {state.data?.matches.map((m) => (
                        <tr key={m.id}>
                          <td>
                            {m.red.ownerName} · {m.red.name}
                          </td>
                          <td>
                            {m.blue.ownerName} · {m.blue.name}
                          </td>
                          <td>
                            {m.result
                              ? outcome(m.result.winner)
                              : status(m.status)}
                          </td>
                          <td>
                            <AppLink href={`${root}/matches/${m.id}`}>
                              {t(($) => $.openMatch)}
                            </AppLink>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {!matchId && (
            <section className="ctf-section">
              <h2>{t(($) => $.myStrategies)}</h2>
              {state.isPending && <p role="status">{t(($) => $.loading)}</p>}
              <div className="ctf-cards">
                {state.data?.mine.map((s) => (
                  <article key={s.id}>
                    <strong>{s.name}</strong>
                    <span>
                      {t(($) => $.revision, { revision: s.revision })} ·{" "}
                      {s.archived
                        ? t(($) => $.archived)
                        : s.published ||
                            state.data?.library.some(
                              (publication) =>
                                publication.id === s.id &&
                                publication.revision === s.revision,
                            ) ||
                            state.data?.entries.some(
                              (publication) =>
                                publication.id === s.id &&
                                publication.revision === s.revision,
                            )
                          ? t(($) => $.published)
                          : t(($) => $.private)}
                    </span>
                    <div>
                      {isArena ? (
                        <AppLink
                          href={`${root}?strategy=${s.id}`}
                          className={buttonVariants({
                            size: "sm",
                            variant: "outline",
                          })}
                        >
                          {t(($) => $.files.viewStrategy)}
                        </AppLink>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => load(s)}
                        >
                          {t(($) => $.files.viewStrategy)}
                        </Button>
                      )}
                      <StrategyImportDialog
                        target={s}
                        disabled={s.archived || busy}
                        onSave={actions.save.mutateAsync}
                        onSaved={imported}
                      />
                      <DialogTrigger
                        render={
                          <Button
                            size="sm"
                            disabled={s.archived || busy}
                            onClick={() => {
                              setNotice("");
                              setEnrolling(s);
                            }}
                          />
                        }
                      >
                        {t(($) => $.enroll)}
                      </DialogTrigger>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={actions.archive.isPending}
                        onClick={() =>
                          void attempt(() =>
                            actions.archive.mutateAsync({
                              id: s.id,
                              archived: !s.archived,
                            }),
                          )
                        }
                      >
                        {s.archived ? t(($) => $.restore) : t(($) => $.archive)}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {!matchId && (
            <section className="ctf-section">
              <h2>{t(($) => $.worldLibrary)}</h2>
              <div className="ctf-cards">
                {state.data?.library.map((s) => (
                  <article key={`${s.id}:${s.revision}`}>
                    <strong>
                      {s.ownerName} · {s.name}
                    </strong>
                    <span>
                      {t(($) => $.revision, { revision: s.revision })} ·{" "}
                      {t(($) => $.published)}
                    </span>
                    <div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void attempt(async () => {
                            const full = await loadStrategy(s.id, s.revision);
                            download(
                              `${s.name}.strategy`,
                              new Blob(
                                [JSON.stringify(full.strategy, null, 2)],
                                { type: "application/json" },
                              ),
                            );
                          })
                        }
                      >
                        {t(($) => $.source)}
                      </Button>
                      {!isArena && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void attempt(() =>
                              choose("blue", `${s.id}:${s.revision}`),
                            )
                          }
                        >
                          {t(($) => $.trial)}
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </main>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(($) => $.enrollTitle)}</DialogTitle>
            <DialogDescription>{t(($) => $.enrollHelp)}</DialogDescription>
          </DialogHeader>
          <p>
            {enrolling?.name} · {enrolling?.revision}
          </p>
          {notice && <p role="alert">{notice}</p>}
          <DialogFooter>
            <DialogClose render={<Button disabled={busy} variant="outline" />}>
              {t(($) => $.cancel)}
            </DialogClose>
            <Button
              disabled={busy || !enrolling}
              onClick={() => {
                if (!enrolling) return;
                void attempt(async () => {
                  const key = `enroll:${enrolling.id}:${enrolling.revision}`;
                  if (request.current?.key !== key)
                    request.current = { key, id: crypto.randomUUID() };
                  await actions.enroll.mutateAsync({
                    requestId: request.current.id,
                    id: enrolling.id,
                    revision: enrolling.revision,
                    hash: enrolling.hash,
                    publish: true,
                  });
                  setConfirmOpen(false);
                });
              }}
            >
              {t(($) => $.confirm)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </div>
    </Dialog>
  );
}
