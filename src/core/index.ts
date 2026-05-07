/**
 * Core layer barrel export
 */

export { EventBus, getEventBus } from "./event-bus.js";
export type { IEventMap, EventName } from "./event-bus.js";

export { CostTracker } from "./cost-tracker.js";
export { PermissionManager } from "./permission-manager.js";
export type { IPermissionRequest, IPermissionResult } from "./permission-manager.js";
export { TaskOrchestrator } from "./task-orchestrator.js";

export { createAemeathAuthStorage, getAuthStoragePath } from "./auth.js";
export { createAemeathModelRegistry, getModelsRegistryPath } from "./model-registry.js";
export { RoleRouter } from "./role-router.js";
export { createAemeathSession } from "./session.js";
export type { AemeathSessionOptions } from "./session.js";
