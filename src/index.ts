/**
 * AemeathCLI — main barrel export
 */

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
  IMCPConfig,
  ISkillDefinition,
  ICredential,
} from "./types/index.js";

export {
  SUPPORTED_MODELS,
  DEFAULT_MODEL_ID,
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

export { getEventBus } from "./core/event-bus.js";
export { CostTracker } from "./core/cost-tracker.js";
export { createAemeathAuthStorage, getAuthStoragePath } from "./core/auth.js";
export { createAemeathModelRegistry, getModelsRegistryPath } from "./core/model-registry.js";
export { RoleRouter } from "./core/role-router.js";
export { createAemeathSession } from "./core/session.js";

export type { AemeathTool, AemeathToolContext, BuildAemeathToolsOptions } from "./tools/types.js";
export { buildAemeathTools } from "./tools/registry.js";
export { createSpawnAgentTool } from "./tools/spawn-agent.js";

export { TeamManager } from "./teams/team-manager.js";
export { SessionAgent } from "./teams/session-agent.js";
export { MessageBus } from "./teams/message-bus.js";
export { PlanApproval } from "./teams/plan-approval.js";
export { TaskStore } from "./teams/task-store.js";

export { LayoutEngine } from "./panes/layout-engine.js";
export { TmuxManager } from "./panes/tmux-manager.js";
export { ITerm2Manager } from "./panes/iterm2-manager.js";
export { IPCHub } from "./panes/ipc-hub.js";
export { PaneProcess } from "./panes/pane-process.js";

export { SkillLoader } from "./skills/loader.js";
export { SkillRegistry } from "./skills/registry.js";
export { SkillExecutor } from "./skills/executor.js";

export { MCPClient } from "./mcp/client.js";
export { MCPServerManager } from "./mcp/server-manager.js";
export { MCPToolBridge } from "./mcp/tool-bridge.js";
