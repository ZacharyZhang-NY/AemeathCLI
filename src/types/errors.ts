/**
 * AemeathCLI Typed Error Hierarchy
 * Per PRD section 15.5: Every error includes code, user message, diagnostic, recovery action
 */

export interface IErrorContext {
  readonly code: string;
  readonly userMessage: string;
  readonly diagnosticMessage?: string | undefined;
  readonly suggestedRecovery?: string | undefined;
}

export abstract class AemeathError extends Error {
  abstract readonly code: string;
  abstract readonly userMessage: string;
  diagnosticMessage?: string | undefined;
  suggestedRecovery?: string | undefined;

  constructor(message: string, context?: Partial<IErrorContext>) {
    super(message);
    this.name = this.constructor.name;
    this.diagnosticMessage = context?.diagnosticMessage;
    this.suggestedRecovery = context?.suggestedRecovery;
  }
}

// ── Provider Errors ──────────────────────────────────────────────────────

export class AuthenticationError extends AemeathError {
  readonly code = "AEMEATH_PROVIDER_AUTH_001" as const;
  readonly userMessage: string;

  constructor(provider: string, message?: string) {
    super(message ?? `Authentication failed for provider: ${provider}`);
    this.userMessage = `Authentication failed for ${provider}. Please re-login with: aemeathcli auth login ${provider}`;
  }
}

export class RateLimitError extends AemeathError {
  readonly code = "AEMEATH_PROVIDER_RATE_001" as const;
  readonly userMessage: string;
  readonly retryAfterMs: number;

  constructor(provider: string, retryAfterMs: number) {
    super(`Rate limited by ${provider}`);
    this.retryAfterMs = retryAfterMs;
    this.userMessage = `Rate limited by ${provider}. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`;
    this.suggestedRecovery = "Wait and retry, or switch to a different provider.";
  }
}

export class ContextOverflowError extends AemeathError {
  readonly code = "AEMEATH_PROVIDER_CTX_001" as const;
  readonly userMessage: string;

  constructor(model: string, maxTokens: number, currentTokens: number) {
    super(`Context overflow for ${model}: ${currentTokens}/${maxTokens}`);
    this.userMessage = `Context window exceeded for ${model}. Use /compact to compress context.`;
  }
}

export class ModelNotFoundError extends AemeathError {
  readonly code = "AEMEATH_PROVIDER_MODEL_001" as const;
  readonly userMessage: string;

  constructor(model: string) {
    super(`Model not found: ${model}`);
    this.userMessage = `Model "${model}" not found. Use /model list to see available models.`;
  }
}

// ── Config Errors ────────────────────────────────────────────────────────

export class MissingConfigError extends AemeathError {
  readonly code = "AEMEATH_CONFIG_MISS_001" as const;
  readonly userMessage: string;

  constructor(key: string) {
    super(`Missing configuration: ${key}`);
    this.userMessage = `Missing configuration "${key}". Run aemeathcli config to set up.`;
  }
}

export class InvalidConfigError extends AemeathError {
  readonly code = "AEMEATH_CONFIG_INVALID_001" as const;
  readonly userMessage: string;

  constructor(key: string, reason: string) {
    super(`Invalid configuration for ${key}: ${reason}`);
    this.userMessage = `Invalid configuration "${key}": ${reason}`;
  }
}

// ── Tool Errors ──────────────────────────────────────────────────────────

export class FileNotFoundError extends AemeathError {
  readonly code = "AEMEATH_TOOL_FILE_001" as const;
  readonly userMessage: string;

  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.userMessage = `File not found: ${filePath}`;
  }
}

export class PermissionDeniedError extends AemeathError {
  readonly code = "AEMEATH_TOOL_PERM_001" as const;
  readonly userMessage: string;

  constructor(operation: string, resource: string) {
    super(`Permission denied: ${operation} on ${resource}`);
    this.userMessage = `Permission denied for ${operation} on ${resource}. Check your permission mode.`;
  }
}

export class ExecutionTimeoutError extends AemeathError {
  readonly code = "AEMEATH_TOOL_TIMEOUT_001" as const;
  readonly userMessage: string;

  constructor(command: string, timeoutMs: number) {
    super(`Execution timeout: ${command} after ${timeoutMs}ms`);
    this.userMessage = `Command timed out after ${Math.ceil(timeoutMs / 1000)}s.`;
  }
}

// ── Team Errors ──────────────────────────────────────────────────────────

export class AgentSpawnError extends AemeathError {
  readonly code = "AEMEATH_TEAM_SPAWN_001" as const;
  readonly userMessage: string;

  constructor(agentName: string, reason: string) {
    super(`Failed to spawn agent ${agentName}: ${reason}`);
    this.userMessage = `Failed to start agent "${agentName}": ${reason}`;
  }
}

export class IPCError extends AemeathError {
  readonly code = "AEMEATH_TEAM_IPC_001" as const;
  readonly userMessage: string;

  constructor(message: string) {
    super(`IPC error: ${message}`);
    this.userMessage = `Inter-agent communication error: ${message}`;
  }
}

// ── MCP Errors ───────────────────────────────────────────────────────────

export class ServerConnectionError extends AemeathError {
  readonly code = "AEMEATH_MCP_CONN_001" as const;
  readonly userMessage: string;

  constructor(serverName: string, reason: string) {
    super(`MCP server connection failed: ${serverName} - ${reason}`);
    this.userMessage = `Cannot connect to MCP server "${serverName}": ${reason}`;
  }
}

export class ToolCallError extends AemeathError {
  readonly code = "AEMEATH_MCP_TOOL_001" as const;
  readonly userMessage: string;

  constructor(toolName: string, reason: string) {
    super(`MCP tool call failed: ${toolName} - ${reason}`);
    this.userMessage = `Tool "${toolName}" failed: ${reason}`;
  }
}

// ── Discriminated Error Union ────────────────────────────────────────────

export type ProviderError =
  | AuthenticationError
  | RateLimitError
  | ContextOverflowError
  | ModelNotFoundError;

export type ConfigError =
  | MissingConfigError
  | InvalidConfigError;

export type ToolError =
  | FileNotFoundError
  | PermissionDeniedError
  | ExecutionTimeoutError;

export type TeamError =
  | AgentSpawnError
  | IPCError;

export type MCPError =
  | ServerConnectionError
  | ToolCallError;

export type AnyAemeathError =
  | ProviderError
  | ConfigError
  | ToolError
  | TeamError
  | MCPError;
