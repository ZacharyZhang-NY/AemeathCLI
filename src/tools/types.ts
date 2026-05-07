import type { Static, TSchema } from "@mariozechner/pi-ai";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { PermissionMode } from "../config/schema.js";

export type ToolCategory = "file" | "search" | "shell" | "web" | "git" | "mcp" | "orchestration";

export interface AemeathToolContext {
  cwd: string;
  projectRoot: string;
  permissionMode: PermissionMode;
  allowedPaths: readonly string[];
  blockedCommands: readonly string[];
  onApprovalNeeded: (toolName: string, params: Record<string, unknown>) => Promise<boolean>;
}

export interface AemeathTool<TParameters extends TSchema = TSchema, TDetails = unknown>
  extends ToolDefinition<TParameters, TDetails> {
  category: ToolCategory;
  requiresApproval: (mode: PermissionMode, params: Static<TParameters>) => boolean;
}

export interface BuildAemeathToolsOptions extends AemeathToolContext {
  spawnSubagent?: ((prompt: string, options?: { model?: string | undefined; role?: string | undefined }) => Promise<string>) | undefined;
}
