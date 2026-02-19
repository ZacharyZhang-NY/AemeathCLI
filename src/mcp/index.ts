/**
 * MCP integration barrel export per PRD section 11
 */

export { MCPClient } from "./client.js";
export type {
  IMCPClientOptions,
  IMCPToolSchema,
  IMCPCallResult,
  IMCPResource,
  IStdioTransportConfig,
  IHttpTransportConfig,
  MCPTransportConfig,
} from "./client.js";

export { MCPServerManager } from "./server-manager.js";
export type {
  IRateLimitConfig,
  IServerManagerOptions,
} from "./server-manager.js";

export { MCPToolBridge } from "./tool-bridge.js";

export { MCPConfigLoader } from "./config.js";
