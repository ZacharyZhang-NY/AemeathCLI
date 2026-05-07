/**
 * Agent team system — barrel export
 */

export { TeamManager } from "./team-manager.js";
export type { ITeamCreateOptions, IAgentDefinition } from "./team-manager.js";

export { SessionAgent } from "./session-agent.js";
export type { SessionAgentMessageCallback } from "./session-agent.js";

export { MessageBus } from "./message-bus.js";
export type { MessageHandler, IMessageTransport, IMessageBusOptions } from "./message-bus.js";

export { TaskStore } from "./task-store.js";

export { PlanApproval } from "./plan-approval.js";
export type { IPlanApprovalResult, IPendingPlan, IPlanApprovalOptions } from "./plan-approval.js";
