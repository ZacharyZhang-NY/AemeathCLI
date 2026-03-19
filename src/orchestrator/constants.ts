/**
 * Orchestrator constants — shared across all orchestrator modules.
 */

import type { ProviderName } from "../types/index.js";

// ── Terminal Status ─────────────────────────────────────────────────────

export type TerminalStatus = "idle" | "processing" | "completed" | "waiting_user_answer" | "error";

// ── CLI Provider Types ──────────────────────────────────────────────────

export type CliProviderType = "claude-code" | "codex" | "gemini-cli" | "kimi-cli" | "ollama";

export const CLI_PROVIDERS: readonly CliProviderType[] = [
  "claude-code", "codex", "gemini-cli", "kimi-cli", "ollama",
] as const;

export const DEFAULT_CLI_PROVIDER: CliProviderType = "claude-code";

// ── Provider CLI → SDK Mapping ──────────────────────────────────────────

export const SDK_FOR_CLI: Record<CliProviderType, ProviderName> = {
  "claude-code": "anthropic",
  "codex": "openai",
  "gemini-cli": "google",
  "kimi-cli": "kimi",
  "ollama": "ollama",
};

// ── Timeouts & Limits ───────────────────────────────────────────────────

export const MAX_BUFFER_BYTES = 5 * 1024 * 1024;           // 5MB per PTY session
export const TAIL_BUFFER_LINES = 200;                       // Lines kept in tail buffer
export const MAX_WORKERS_PER_SESSION = 10;                  // Max concurrent workers
export const MAX_ORCHESTRATOR_STEPS = 30;                   // Max supervisor tool-call rounds
export const MAX_HANDOFF_DEPTH = 5;                         // Max nested handoffs
export const MAX_OUTPUT_EXTRACT_BYTES = 100 * 1024;         // 100KB tool result truncation

export const PROVIDER_INIT_TIMEOUT_MS = 30_000;             // 30s provider startup
export const HANDOFF_TIMEOUT_MS = 600_000;                  // 10min default handoff
export const SHELL_READY_TIMEOUT_MS = 10_000;               // 10s shell boot
export const STATUS_POLL_INTERVAL_MS = 2_000;               // 2s status check interval
export const INBOX_POLL_INTERVAL_MS = 5_000;                // 5s inbox delivery check
export const WINDOWS_KILL_TIMEOUT_MS = 5_000;               // 5s force-kill on Windows
export const EXIT_DRAIN_DELAY_MS = 200;                     // 200ms onExit drain

// ── Data Models ─────────────────────────────────────────────────────────

export interface TerminalRecord {
  id: string;
  sessionId: string;
  pid?: number | undefined;
  provider: CliProviderType;
  agentProfile?: string | undefined;
  status: TerminalStatus;
  createdAt: Date;
}

export interface SessionRecord {
  sessionId: string;
  pid?: number | undefined;
  workerCount: number;
  providers: CliProviderType[];
  createdAt: Date;
}

export interface InboxMessage {
  id: number;
  sender: string;
  receiver: string;
  content: string;
  status: "pending" | "delivered" | "failed";
  createdAt: Date;
  deliveredAt?: Date | undefined;
}

export interface AgentProfile {
  name: string;
  description: string;
  provider?: CliProviderType | undefined;
  systemPrompt: string;
}

export interface WorkerInfo {
  terminalId: string;
  provider: CliProviderType;
  status: TerminalStatus;
}

export interface SpawnOptions {
  provider: CliProviderType;
  agentProfile?: string | undefined;
  workingDirectory?: string | undefined;
  model?: string | undefined;
}
