/**
 * AemeathCLI — main barrel export
 * Per PRD section 6.2 — public API surface for programmatic usage.
 */

// ── Types ───────────────────────────────────────────────────────────────

export type {
  ProviderName,
  ModelRole,
  IModelInfo,
  IRoleConfig,
  IModelResolution,
  ITokenUsage,
  MessageRole,
  IChatMessage,
  IToolCall,
  IToolResult,
  IStreamChunk,
  IChatRequest,
  IChatResponse,
  IToolDefinition,
  IToolParameter,
  AgentMessageType,
  IAgentMessage,
  PermissionMode,
  ToolCategory,
  IToolRegistration,
  IToolExecutionContext,
  IToolRegistry,
  TaskStatus,
  ITask,
  IAgentConfig,
  IAgentState,
  ITeamConfig,
  PaneLayout,
  IPaneConfig,
  ILayoutConfig,
  IGlobalConfig,
  IMCPConfig,
  ISkillDefinition,
  ICredential,
} from "./types/index.js";

export {
  SUPPORTED_MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_CONFIG,
  AemeathError,
  AuthenticationError,
  RateLimitError,
  ContextOverflowError,
  ModelNotFoundError,
  MissingConfigError,
  InvalidConfigError,
  FileNotFoundError,
  PermissionDeniedError,
  ExecutionTimeoutError,
  AgentSpawnError,
  IPCError,
  ServerConnectionError,
  ToolCallError,
} from "./types/index.js";

// ── Core ────────────────────────────────────────────────────────────────

export { getEventBus } from "./core/event-bus.js";
export { ModelRouter, createModelRouter } from "./core/model-router.js";
export { ContextManager } from "./core/context-manager.js";
export { CostTracker } from "./core/cost-tracker.js";
export { PermissionManager } from "./core/permission-manager.js";
export { TaskOrchestrator } from "./core/task-orchestrator.js";

// ── Providers ───────────────────────────────────────────────────────────

export type { IModelProvider, IProviderOptions } from "./providers/types.js";
export { ProviderRegistry } from "./providers/registry.js";
export { ClaudeAdapter } from "./providers/claude-adapter.js";
export { OpenAIAdapter } from "./providers/openai-adapter.js";
export { GeminiAdapter } from "./providers/gemini-adapter.js";
export { KimiAdapter } from "./providers/kimi-adapter.js";
export { OllamaAdapter } from "./providers/ollama-adapter.js";
export {
  ClaudeNativeCLIAdapter,
  CodexNativeCLIAdapter,
  GeminiNativeCLIAdapter,
  KimiNativeCLIAdapter,
} from "./providers/native-cli-adapters.js";

// ── Tools ───────────────────────────────────────────────────────────────

export { ToolRegistry } from "./tools/registry.js";
export { createDefaultRegistry } from "./tools/index.js";

// ── Auth ────────────────────────────────────────────────────────────────

export { CredentialStore } from "./auth/credential-store.js";
export { SessionManager } from "./auth/session-manager.js";

// ── Storage ─────────────────────────────────────────────────────────────

export { SqliteStore } from "./storage/sqlite-store.js";
export { ConfigStore } from "./storage/config-store.js";
export { ConversationStore } from "./storage/conversation-store.js";

// ── Teams ───────────────────────────────────────────────────────────────

export { TeamManager } from "./teams/team-manager.js";
export { AgentProcess } from "./teams/agent-process.js";
export { MessageBus } from "./teams/message-bus.js";
export { PlanApproval } from "./teams/plan-approval.js";
export { TaskStore } from "./teams/task-store.js";

// ── Panes ───────────────────────────────────────────────────────────────

export { LayoutEngine } from "./panes/layout-engine.js";
export { TmuxManager } from "./panes/tmux-manager.js";
export { ITerm2Manager } from "./panes/iterm2-manager.js";
export { IPCHub } from "./panes/ipc-hub.js";
export { PaneProcess } from "./panes/pane-process.js";

// ── Skills ──────────────────────────────────────────────────────────────

export { SkillLoader } from "./skills/loader.js";
export { SkillRegistry } from "./skills/registry.js";
export { SkillExecutor } from "./skills/executor.js";

// ── MCP ─────────────────────────────────────────────────────────────────

export { MCPClient } from "./mcp/client.js";
export { MCPServerManager } from "./mcp/server-manager.js";
export { MCPToolBridge } from "./mcp/tool-bridge.js";
