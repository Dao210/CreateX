import { useEffect, useMemo, useRef } from "react";
import { BattleTelemetry, captureEvent, type BattleContext, type GameName } from "@auro/core/analytics";

export function useGameOpened(game: GameName, workspaceId: string | undefined, mode: string, ready = true): void {
  const last = useRef("");
  useEffect(() => {
    const key = `${game}:${workspaceId}:${mode}`;
    if (!ready || !workspaceId || last.current === key) return;
    last.current = key;
    captureEvent("game_opened", { game, workspace_id: workspaceId, mode });
  }, [game, workspaceId, mode, ready]);
}

export function useBattleTelemetry(identity: object | null, context: BattleContext, phase: string, paused: boolean): void {
  const { game, workspace_id, mode, level_id, difficulty, resumed } = context;
  const telemetry = useMemo(() => identity ? new BattleTelemetry({ game, workspace_id, mode, level_id, difficulty, resumed }, captureEvent) : null,
    [identity, game, workspace_id, mode, level_id, difficulty, resumed]);
  useEffect(() => { telemetry?.observe(phase, paused); }, [telemetry, phase, paused]);
}
