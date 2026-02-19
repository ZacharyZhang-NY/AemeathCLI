/**
 * Agent team system — barrel export
 * Per PRD section 8: Team coordination, agent processes, messaging, task persistence.
 */

export { TeamManager } from "./team-manager.js";
export type { ITeamCreateOptions, IAgentDefinition } from "./team-manager.js";

export { AgentProcess } from "./agent-process.js";
export type {
  IAgentProcessOptions,
  AgentMessageCallback,
} from "./agent-process.js";

export { MessageBus } from "./message-bus.js";
export type {
  MessageHandler,
  IMessageTransport,
  IMessageBusOptions,
} from "./message-bus.js";

export { TaskStore } from "./task-store.js";

export { PlanApproval } from "./plan-approval.js";
export type {
  IPlanApprovalResult,
  IPendingPlan,
  IPlanApprovalOptions,
} from "./plan-approval.js";
