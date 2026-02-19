/**
 * Tool types per PRD sections 5.1, 14.4
 */

import type { IToolDefinition, IToolResult, IToolCall } from "./message.js";

// ── Permission Modes (PRD section 14.4) ──────────────────────────────────

export type PermissionMode = "strict" | "standard" | "permissive";

// ── Tool Categories ──────────────────────────────────────────────────────

export type ToolCategory = "file" | "search" | "shell" | "web" | "git" | "mcp";

// ── Tool Registration ────────────────────────────────────────────────────

export interface IToolRegistration {
  readonly definition: IToolDefinition;
  readonly category: ToolCategory;
  readonly requiresApproval: (mode: PermissionMode, args: Record<string, unknown>) => boolean;
  readonly execute: (args: Record<string, unknown>) => Promise<IToolResult>;
}

// ── Tool Execution Context ───────────────────────────────────────────────

export interface IToolExecutionContext {
  readonly workingDirectory: string;
  readonly permissionMode: PermissionMode;
  readonly projectRoot: string;
  readonly allowedPaths: readonly string[];
  readonly blockedCommands: readonly string[];
}

// ── Tool Registry Interface ──────────────────────────────────────────────

export interface IToolRegistry {
  register(tool: IToolRegistration): void;
  get(name: string): IToolRegistration | undefined;
  getAll(): readonly IToolRegistration[];
  getDefinitions(): readonly IToolDefinition[];
  execute(call: IToolCall, context: IToolExecutionContext): Promise<IToolResult>;
}
