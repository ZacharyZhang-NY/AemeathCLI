/**
 * Team types per PRD section 8
 */

import type { ModelRole, ProviderName } from "./model.js";
import type { AgentMessageType } from "./message.js";

// ── Task Status (PRD section 8.5) ────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

// ── Task Definition ──────────────────────────────────────────────────────

export interface ITask {
  readonly id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  owner?: string | undefined;
  model?: string | undefined;
  role?: ModelRole | undefined;
  blocks: string[];
  blockedBy: string[];
  readonly createdAt: Date;
  updatedAt: Date;
}

// ── Agent Definition ─────────────────────────────────────────────────────

export type AgentStatus = "idle" | "active" | "error" | "shutdown";

export interface IAgentConfig {
  readonly name: string;
  readonly agentId: string;
  readonly agentType: string;
  readonly model: string;
  readonly provider: ProviderName;
  readonly role: ModelRole;
}

export interface IAgentState {
  readonly config: IAgentConfig;
  status: AgentStatus;
  currentTaskId?: string | undefined;
  paneId?: string | undefined;
}

// ── Team Definition ──────────────────────────────────────────────────────

export type TeamStatus = "active" | "completed" | "error";

export interface ITeamConfig {
  readonly teamName: string;
  readonly description?: string | undefined;
  status: TeamStatus;
  readonly members: readonly IAgentConfig[];
  readonly createdAt: Date;
}

// ── IPC Message Protocol (PRD section 9.4) ───────────────────────────────

export type IPCMethod =
  | "agent.register"
  | "agent.streamChunk"
  | "agent.taskUpdate"
  | "agent.message"
  | "hub.taskAssign"
  | "hub.shutdown";

export interface IIPCMessage {
  readonly jsonrpc: "2.0";
  readonly method: IPCMethod;
  readonly params: Record<string, unknown>;
  readonly id?: number | undefined;
}

export interface IIPCResponse {
  readonly jsonrpc: "2.0";
  readonly result?: unknown | undefined;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  } | undefined;
  readonly id: number;
}

// ── Pane Layout (PRD section 9.2) ────────────────────────────────────────

export type PaneLayout = "auto" | "horizontal" | "vertical" | "grid";

export interface IPaneConfig {
  readonly paneId: string;
  readonly agentName: string;
  readonly model: string;
  readonly role: ModelRole;
  readonly title: string;
}

export interface ILayoutConfig {
  readonly layout: PaneLayout;
  readonly panes: readonly IPaneConfig[];
  readonly maxPanes: number;
}
