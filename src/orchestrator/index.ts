/**
 * Orchestrator barrel export — public API surface.
 *
 * Re-exports all major orchestrator modules so consumers
 * can import from a single path: `import { ... } from "./orchestrator/index.js"`.
 */

export { OrchestratorEngine } from "./engine.js";
export type { RunOptions, OrchestratorResult, OrchestratorDeps } from "./engine.js";
export { PtySessionManager } from "./pty/session-manager.js";
export { TmuxOverlay } from "./pty/tmux-overlay.js";
export { StateStore } from "./state-store.js";
export { WorkerManager } from "./worker-manager.js";
export { CliProviderManager } from "./cli-providers/cli-provider-manager.js";
export { ProfileLoader } from "./profiles/profile-loader.js";
export { createOrchestrationTools } from "./tools/orchestration-tools.js";
export { detectInstalledProviders } from "./utils/detect-providers.js";
export * from "./constants.js";
