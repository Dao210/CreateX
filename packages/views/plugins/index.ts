export { PluginSurfaceFrame } from "./plugin-surface-frame";
export { buildSurfaceFrameDocument } from "./surface-document";
export {
  collectManualHookActions,
  pluginHookActionKey,
  usePluginHookActions,
  useRunPluginHook,
} from "./plugin-hook-actions";
export type { PluginHookAction } from "./plugin-hook-actions";
export {
  PluginModalSurface,
  collectModalSurfaces,
  pluginModalKey,
  usePluginModalSurfaces,
} from "./plugin-modal-surface";
export type { PluginModalTarget } from "./plugin-modal-surface";
export { PluginHookActivity, PluginScheduleActivity, summarizeInvocations } from "./plugin-hook-activity";
export { PluginMCPApproval, mcpHooks, initialSelection } from "./plugin-mcp-approval";
