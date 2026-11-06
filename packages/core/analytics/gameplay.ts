export type GameName = "siege" | "tanks";

export interface BattleContext {
  game: GameName;
  workspace_id: string;
  mode: string;
  level_id?: number;
  difficulty?: string;
  resumed?: boolean;
}

type Capture = (event: string, properties: Record<string, unknown>) => void;

/** One observed attempt. Missing terminal events are not inferred as defeats. */
export class BattleTelemetry {
  private started = false;
  private ended = false;
  private activeSince: number | null = null;
  private activeMs = 0;
  private readonly attemptId = crypto.randomUUID();

  constructor(private readonly context: BattleContext, private readonly capture: Capture) {}

  observe(phase: string, paused: boolean, now = performance.now()): void {
    if (this.ended || !this.context.workspace_id) return;
    if (this.activeSince !== null) this.activeMs += Math.max(0, now - this.activeSince);
    this.activeSince = null;
    if (phase === "running" && !paused && !this.started) {
      this.started = true;
      this.emit("battle_started", {});
    }
    if (this.started && ["cleared", "victory", "defeat", "completed"].includes(phase)) {
      this.ended = true;
      this.emit("battle_ended", {
        result: phase === "cleared" ? "level_cleared" : phase,
        active_duration_ms: Math.round(this.activeMs),
        record_source: "client_reported",
      });
    } else if (this.started && phase === "running" && !paused) {
      this.activeSince = now;
    }
  }

  private emit(event: string, properties: Record<string, unknown>): void {
    try {
      this.capture(event, { ...this.context, attempt_id: this.attemptId, ...properties });
    } catch { /* Analytics must never interrupt gameplay. */ }
  }
}
