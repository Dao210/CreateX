// Doodle Siege, shared by web and desktop.
//
// The game used to be a standalone Vite SPA under apps/siege. Everything that
// was DOM-shaped now takes a SiegePlatform instead of reaching for a global, so
// the same components run in Next.js and in the Electron renderer (both
// Chromium), and a native client only has to supply its own platform.
//
// Rapier and Canvas stay here rather than in @auro/core on purpose: they are
// browser runtime, not game rules. See docs/siege-integration-plan.md §4.3.
export { SiegeWorkshop } from "./siege-workshop";
export { CampaignApp } from "./campaign/campaign-app";
export { createWebSiegePlatform } from "./platform/web";
export { Arena } from "./arena/siege-arena";
export { DrawingCanvas, drawStrokes, type CanvasTool } from "./editor/drawing-canvas";
export { DesignMetrics, BattleMetrics } from "./workshop/metrics";
export { CannonWorkshop } from "./workshop/cannon-workshop";
export { paintCannon } from "./workshop/cannon-painter";
export { ArenaEngine } from "./runtime/engine";
export { CampaignEngine } from "./campaign/engine";
