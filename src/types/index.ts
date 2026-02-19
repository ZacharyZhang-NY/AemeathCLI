/**
 * AemeathCLI shared types — barrel export
 */

export type {
  ProviderName,
  ModelRole,
  IModelInfo,
  IRoleConfig,
  ModelResolutionSource,
  IModelResolution,
  ITokenUsage,
} from "./model.js";

export { SUPPORTED_MODELS, DEFAULT_MODEL_ID } from "./model.js";

export type {
  MessageRole,
  IChatMessage,
  IToolCall,
  IToolResult,
  StreamChunkType,
  IStreamChunk,
  IChatRequest,
  IChatResponse,
  IToolParameter,
  IToolDefinition,
  AgentMessageType,
  IAgentMessage,
} from "./message.js";

export type {
  PermissionMode,
  ToolCategory,
  IToolRegistration,
  IToolExecutionContext,
  IToolRegistry,
} from "./tool.js";

export type {
  TaskStatus,
  ITask,
  AgentStatus,
  IAgentConfig,
  IAgentState,
  TeamStatus,
  ITeamConfig,
  IPCMethod,
  IIPCMessage,
  IIPCResponse,
  PaneLayout,
  IPaneConfig,
  ILayoutConfig,
} from "./team.js";

export type {
  IProviderConfig,
  IPermissionConfig,
  PaneBackend,
  ISplitPanelConfig,
  ICostConfig,
  ITelemetryConfig,
  IOAuthProviderConfig,
  IOAuthConfig,
  IGlobalConfig,
  IMCPServerConfig,
  IMCPConfig,
  ISkillFrontmatter,
  ISkillDefinition,
  AuthMethod,
  ICredential,
} from "./config.js";

export { DEFAULT_CONFIG } from "./config.js";

export {
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
} from "./errors.js";

export type {
  IErrorContext,
  ProviderError,
  ConfigError,
  ToolError,
  TeamError,
  MCPError,
  AnyAemeathError,
} from "./errors.js";
