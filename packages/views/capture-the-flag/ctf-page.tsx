"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
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
  FileUp,
  Check,
  Trophy,
} from "lucide-react";
import {
  createCTFDraftStore,
  TrialMessageSchema,
  type TrialResult,
  newMatch,
  tickMatch,
  frameOf,
  makeBaselineStrategy,
  validateStrategy,
  StrategySchema,
  ctfStateOptions,
  ctfMatchOptions,
  useCTFActions,
  useCTFStrategyLoader,
  GAME_VERSION,
  type Frame,
  type Match,
  type Strategy,
  type StrategySummary,
} from "@auro/core/capture-the-flag";
import { authenticatedFetch } from "@auro/core/api";
import { useCurrentWorkspace, useWorkspacePaths } from "@auro/core/paths";
import { useAuthStore } from "@auro/core/auth";
import type { StorageAdapter } from "@auro/core/types";
import { Button, buttonVariants } from "@auro/ui/components/ui/button";
import { Input } from "@auro/ui/components/ui/input";
import { Textarea } from "@auro/ui/components/ui/textarea";
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
import { BattleCanvas } from "./battle-canvas";

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

export function CTFPage({ storage }: { storage: StorageAdapter }) {
  const ws = useCurrentWorkspace(),
    user = useAuthStore((s) => s.user);
  if (!ws || !user) return null;
  return (
    <GameAccessBoundary gameId="ctf">
      <Content
        key={`${ws.id}:${user.id}`}
        wsId={ws.id}
        userId={user.id}
        storage={storage}
      />
    </GameAccessBoundary>
  );
}
function Content({
  wsId,
  userId,
  storage,
}: {
  wsId: string;
  userId: string;
  storage: StorageAdapter;
}) {
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
  const draftKey = `ctf:draft:${userId}:${wsId}`;
  const [draftStore] = useState(() =>
    createCTFDraftStore(storage, draftKey, JSON.stringify(baseline(), null, 2)),
  );
  const text = useStore(draftStore, (d) => d.text),
    name = useStore(draftStore, (d) => d.name),
    editing = useStore(draftStore, (d) => d.source);
  const setText = useCallback(
    (text: string) => draftStore.getState().update({ text }),
    [draftStore],
  );
  const setName = useCallback(
    (name: string) => draftStore.getState().update({ name }),
    [draftStore],
  );
  const setEditing = useCallback(
    (value: { id: string; revision: number } | null) =>
      draftStore.getState().update({
        source: value ? { id: value.id, revision: value.revision } : null,
      }),
    [draftStore],
  );
  const [sourceLoading, setSourceLoading] = useState(false);
  const generations = useRef({ red: 0, blue: 0, editor: 0 });
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [red, setRed] = useState<Strategy>(() => baseline());
  const [blue, setBlue] = useState<Strategy>(() =>
    makeBaselineStrategy("opponent", "Baseline", "blue"),
  );
  const [redKey, setRedKey] = useState("baseline"),
    [blueKey, setBlueKey] = useState("baseline");
  const [seed, setSeed] = useState(12027),
    [speed, setSpeed] = useState(1),
    [running, setRunning] = useState(false);
  const [initialMatch] = useState(() => newMatch(seed, { red, blue }));
  const engine = useRef<Match>(initialMatch);
  const [frame, setFrame] = useState<Frame>(() => frameOf(engine.current));
  const [recordingIndex, setRecordingIndex] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [enrolling, setEnrolling] = useState<StrategySummary | null>(null);
  const importInput = useRef<HTMLInputElement>(null),
    stage = useRef<HTMLDivElement>(null);
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
  const reset = (nextRed = red, nextBlue = blue, nextSeed = seed) => {
    setRunning(false);
    engine.current = newMatch(nextSeed, { red: nextRed, blue: nextBlue });
    setFrame(frameOf(engine.current));
  };
  const step = () => {
    tickMatch(engine.current, { headless: true });
    setFrame(frameOf(engine.current));
    if (engine.current.result) setRunning(false);
  };
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      for (let i = 0; i < Math.max(1, speed); i++)
        tickMatch(engine.current, { headless: true });
      setFrame(frameOf(engine.current));
      if (engine.current.result) setRunning(false);
    }, 250);
    return () => clearInterval(timer);
  }, [running, speed]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setRunning(false);
    };
    const fullscreen = () => {
      if (!document.fullscreenElement) setRunning(false);
    };
    document.addEventListener("visibilitychange", pause);
    document.addEventListener("fullscreenchange", fullscreen);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      document.removeEventListener("fullscreenchange", fullscreen);
    };
  }, []);
  const loaded = useRef("");
  useEffect(() => {
    const selected = navigation.searchParams.get("strategy");
    if (!selected || loaded.current === selected) return;
    const record = state.data?.mine.find((s) => s.id === selected);
    if (record) {
      loaded.current = selected;
      const generation = ++generations.current.editor;
      setSourceLoading(true);
      void loadStrategy(record.id, record.revision)
        .then((full) => {
          if (generation !== generations.current.editor) return;
          setEditing(full);
          setText(JSON.stringify(full.strategy, null, 2));
          setName(full.name);
        })
        .catch(() => setNotice(t(($) => $.error)))
        .finally(() => {
          if (generation === generations.current.editor)
            setSourceLoading(false);
        });
    }
  }, [
    navigation.searchParams,
    state.data,
    loadStrategy,
    t,
    setEditing,
    setName,
    setText,
  ]);
  useEffect(() => {
    stopTrial();
    setRunning(false);
    setReplaying(false);
    setRecordingIndex(0);
  }, [isArena, matchId, stopTrial]);
  const recorded = matchQuery.data?.frames ?? [];
  useEffect(() => {
    if (!replaying || recorded.length < 2) return;
    const timer = setInterval(
      () =>
        setRecordingIndex((i) => {
          if (i >= recorded.length - 1) {
            setReplaying(false);
            return i;
          }
          return i + 1;
        }),
      1000 / speed,
    );
    return () => clearInterval(timer);
  }, [replaying, recorded.length, speed]);
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
  const parse = () => {
    try {
      const value: unknown = JSON.parse(text);
      const problems = validateStrategy(value);
      setErrors(problems);
      if (problems.length) return null;
      return StrategySchema.parse(value);
    } catch {
      setErrors([t(($) => $.invalid)]);
      return null;
    }
  };

  const runTrials = async () => {
    const challenger = parse();
    if (!challenger) return;
    stopTrial();
    setRunning(false);
    setTrialResults([]);
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
  const choose = async (side: "red" | "blue", key: string) => {
    const generation = ++generations.current[side];
    const c = choices.find((s) => `${s.id}:${s.revision}` === key);
    const strategy = c
      ? (await loadStrategy(c.id, c.revision)).strategy
      : makeBaselineStrategy(
          side,
          t(($) => $.baseline),
          side,
        );
    if (generation !== generations.current[side]) return;
    if (side === "red") {
      setRed(strategy);
      setRedKey(key);
      reset(strategy, blue);
    } else {
      setBlue(strategy);
      setBlueKey(key);
      reset(red, strategy);
    }
  };
  const save = async () => {
    const strategy = parse();
    if (!strategy) return;
    const input = {
      id: editing?.id,
      expectedRevision: editing?.revision ?? 0,
      name: name.trim() || strategy.team.team_name,
      strategy,
    };
    const key = JSON.stringify(input);
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    await attempt(async () => {
      const result = await actions.save.mutateAsync({
        ...input,
        requestId: request.current!.id,
      });
      setEditing(result);
      setName(result.name);
      setNotice(t(($) => $.saved));
    });
  };
  const load = (record: StrategySummary) => {
    void attempt(async () => {
      const generation = ++generations.current.editor;
      setSourceLoading(true);
      const full = await loadStrategy(record.id, record.revision).finally(
        () => {
          if (generation === generations.current.editor)
            setSourceLoading(false);
        },
      );
      if (generation !== generations.current.editor) return;
      setEditing(full);
      setName(full.name);
      setText(JSON.stringify(full.strategy, null, 2));
      setErrors([]);
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
  const shown = matchId
    ? recorded[Math.min(recordingIndex, recorded.length - 1)]
    : frame;
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
          {matchId ? (
            <section className="ctf-match">
              {matchQuery.isPending && (
                <p role="status">{t(($) => $.loading)}</p>
              )}
              {matchQuery.isError && (
                <p role="alert">
                  {t(($) => $.error)}
                  <Button onClick={() => void matchQuery.refetch()}>
                    {t(($) => $.retry)}
                  </Button>
                </p>
              )}
              {matchQuery.data && (
                <>
                  <div className="ctf-matchup">
                    <strong>
                      {matchQuery.data.red.ownerName} ·{" "}
                      {matchQuery.data.red.name}
                    </strong>
                    <span>{status(matchQuery.data.status)}</span>
                    <strong>
                      {matchQuery.data.blue.ownerName} ·{" "}
                      {matchQuery.data.blue.name}
                    </strong>
                  </div>
                  {shown ? (
                    <BattleCanvas frame={shown} label={t(($) => $.replay)} />
                  ) : (
                    <p className="ctf-empty">{t(($) => $.emptyFrames)}</p>
                  )}
                  <div className="ctf-controls">
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
                      {matchQuery.data.result
                        ? outcome(matchQuery.data.result.winner)
                        : status(matchQuery.data.status)}
                    </span>
                    <code>{matchQuery.data.seed}</code>
                  </div>
                </>
              )}
              {shown && <DecisionPanels frame={shown} />}
            </section>
          ) : !isArena ? (
            <>
              <div className="ctf-matchup">
                {(["red", "blue"] as const).map((side) => (
                  <label key={side} className={`ctf-side ctf-${side}`}>
                    <span>
                      {side === "red" ? t(($) => $.red) : t(($) => $.blue)}
                    </span>
                    <select
                      value={side === "red" ? redKey : blueKey}
                      onChange={(e) =>
                        void attempt(() => choose(side, e.target.value))
                      }
                    >
                      <option value="baseline">{t(($) => $.baseline)}</option>
                      <option value="draft">{t(($) => $.draftTrial)}</option>
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
                ))}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t(($) => $.swap)}
                  onClick={() => {
                    setRed(blue);
                    setBlue(red);
                    setRedKey(blueKey);
                    setBlueKey(redKey);
                    reset(blue, red);
                  }}
                >
                  <ArrowLeftRight />
                </Button>
              </div>
              <div ref={stage} className="ctf-stage">
                {shown && (
                  <BattleCanvas frame={shown} label={t(($) => $.trial)} />
                )}
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
              </div>
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
              </div>
              <div className="ctf-lower">
                <section className="ctf-editor">
                  <div className="ctf-section-head">
                    <h2>{t(($) => $.editor)}</h2>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(null);
                        setName("");
                        setText(JSON.stringify(baseline(), null, 2));
                        setErrors([]);
                      }}
                    >
                      {t(($) => $.newStrategy)}
                    </Button>
                  </div>
                  <label>
                    {t(($) => $.strategyName)}
                    <Input
                      value={name}
                      maxLength={128}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <Textarea
                    spellCheck={false}
                    aria-label={t(($) => $.editor)}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="ctf-json"
                  />
                  <input
                    ref={importInput}
                    type="file"
                    accept=".strategy,.json,application/json"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = "";
                      void attempt(async () => {
                        if (file.size > 256 * 1024)
                          throw new Error("file_too_large");
                        const content = await file.text();
                        setEditing(null);
                        setText(content);
                        setName(
                          file.name
                            .replace(/\.(strategy|json)$/i, "")
                            .slice(0, 128),
                        );
                        setErrors([]);
                      });
                    }}
                  />
                  <div className="ctf-editor-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => importInput.current?.click()}
                    >
                      <FileUp />
                      {t(($) => $.importFile)}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const value = parse();
                        if (value)
                          download(
                            `${name || "strategy"}.strategy`,
                            new Blob([JSON.stringify(value, null, 2)], {
                              type: "application/json",
                            }),
                          );
                      }}
                    >
                      {t(($) => $.exportFile)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (parse()) setNotice(t(($) => $.valid));
                      }}
                    >
                      <Check />
                      {t(($) => $.validate)}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !state.data}
                      onClick={() => void save()}
                    >
                      {t(($) => $.save)}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const strategy = parse();
                        if (strategy) {
                          setRed(strategy);
                          setRedKey("draft");
                          reset(strategy, blue);
                        }
                      }}
                    >
                      {t(($) => $.trial)}
                    </Button>
                  </div>
                  <div className="ctf-editor-actions">
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
                  {trialResults.length > 0 && (
                    <section className="ctf-trial-results">
                      <h2>{t(($) => $.trialResults)}</h2>
                      <div className="ctf-table-scroll">
                        <table>
                          <tbody>
                            {trialResults.map((row) => (
                              <tr key={row.index}>
                                <td>{row.name}</td>
                                <td>{outcome(row.result.winner)}</td>
                                <td>{row.duration.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                  {errors.length > 0 && (
                    <ul role="alert" className="ctf-errors">
                      {errors.slice(0, 12).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  )}
                  <p className="ctf-caption">{t(($) => $.newSaveNote)}</p>
                </section>
                <DecisionPanels frame={shown} />
              </div>
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
                          {t(($) => $.editor)}
                        </AppLink>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => load(s)}
                        >
                          {t(($) => $.editor)}
                        </Button>
                      )}
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

function DecisionPanels({ frame }: { frame: Frame | undefined }) {
  const { t } = useT("ctf");
  return (
    <aside>
      <details className="ctf-details">
        <summary>{t(($) => $.decision)}</summary>
        {frame?.units.map((u) => (
          <article key={u.id}>
            <strong>
              {u.team === "red" ? t(($) => $.red) : t(($) => $.blue)} ·{" "}
              {u.unitType === "cavalry"
                ? t(($) => $.cavalry)
                : u.unitType === "archer"
                  ? t(($) => $.archer)
                  : t(($) => $.heavy_infantry)}
            </strong>
            <span>
              {Math.round(u.hp)} / {u.maxHp}
            </span>
            <pre>{JSON.stringify(frame.decisions[u.id] ?? {}, null, 2)}</pre>
          </article>
        ))}
      </details>
      <details className="ctf-details">
        <summary>{t(($) => $.events)}</summary>
        <ol>
          {frame?.logs
            .slice()
            .reverse()
            .map((line, i) => (
              <li key={i}>{line}</li>
            ))}
        </ol>
      </details>
    </aside>
  );
}
