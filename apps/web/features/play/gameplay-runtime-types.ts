export type GameplayPlayer = { destroy(): void };
export type GameplayRuntime = { mount(frame: HTMLElement): GameplayPlayer };

declare global {
  interface Window { auroGameplay?: GameplayRuntime }
}
