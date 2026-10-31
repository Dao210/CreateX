import { useCallback, useRef } from "react";
import { useStartTankTraining, useSettleTankTraining, type TankDefenseGame, type TankPlaySession, type TankTrainingRun, type SettleTankTrainingInput } from "@auro/core/tank-defense";

interface Attempt {
  sessionId: string;
  requestId: string;
  start?: Promise<TankTrainingRun>;
  summary?: SettleTankTrainingInput;
  finish?: Promise<void>;
}

/** Per-run identities survive retries; API data remains in Query's mutations. */
export function useTankTraining(workspaceId: string, session: TankPlaySession | undefined, userId: string) {
  const begin = useStartTankTraining(workspaceId);
  const settle = useSettleTankTraining(workspaceId);
  const attempts = useRef(new WeakMap<TankDefenseGame, Attempt>());
  const lastFailed = useRef<{ game: TankDefenseGame; outcome: SettleTankTrainingInput["outcome"] } | null>(null);
  const activeGame = useRef<TankDefenseGame | null>(null);
  const owner = session?.character.ownerId === userId && Boolean(session?.progression);
  const beginAsync = begin.mutateAsync;
  const settleAsync = settle.mutateAsync;
  const prepare = useCallback(async (game: TankDefenseGame) => {
    if (!owner || !session) return;
    let attempt = attempts.current.get(game);
    if (!attempt) {
      attempt = { sessionId: session.id, requestId: crypto.randomUUID() };
      attempts.current.set(game, attempt);
    }
    const current = attempt;
    current.start ??= beginAsync({ sessionId: current.sessionId, characterId: session.character.id, requestId: current.requestId, levelId: game.level.id }).catch(error => { current.start = undefined; throw error; });
    await current.start;
    activeGame.current = game;
  }, [owner, session, beginAsync]);
  const finish = useCallback(async (game: TankDefenseGame, outcome: SettleTankTrainingInput["outcome"]) => {
    const attempt = attempts.current.get(game);
    if (!attempt?.start) return;
    attempt.summary ??= { ticks: game.tick, kills: game.kills, outcome };
    attempt.finish ??= attempt.start.then(async run => {
      await settleAsync({ sessionId: attempt.sessionId, runId: run.id, characterId: run.characterId, ...attempt.summary! });
      lastFailed.current = null;
    }).catch(error => {
      attempt.finish = undefined;
      lastFailed.current = { game, outcome };
      throw error;
    });
    await attempt.finish;
  }, [settleAsync]);
  const retry = () => {
    const failed = lastFailed.current;
    if (failed) void finish(failed.game, failed.outcome).catch(() => {});
  };
  const finishActive = async () => {
    const game = activeGame.current;
    if (!game) return;
    game.setPaused(true);
    await finish(game, game.phase === "cleared" || game.phase === "victory" || game.phase === "defeat" ? game.phase : "abandoned");
  };
  return { prepare: owner ? prepare : undefined, finish: owner ? finish : undefined, finishActive, retry, busy: begin.isPending || settle.isPending, startError: begin.isError, settleError: settle.isError, result: settle.data };
}
