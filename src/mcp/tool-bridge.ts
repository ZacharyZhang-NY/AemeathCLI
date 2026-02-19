/**
 * MCP tool bridge per PRD section 11.3
 * Converts MCP tool schemas to AemeathCLI IToolDefinition format and back.
 * Registers MCP tools into the unified tool registry with lazy loading.
 * Tool namespacing: mcp__{serverName}__{toolName}
 */

import { logger } from "../utils/logger.js";
import { ToolCallError } from "../types/errors.js";
import type { IToolDefinition, IToolParameter, IToolCall, IToolResult } from "../types/message.js";
import type { IToolRegistration, IToolRegistry, ToolCategory } from "../types/tool.js";
import type { PermissionMode } from "../types/tool.js";
import type { MCPServerManager } from "./server-manager.js";
import type { IMCPToolSchema } from "./client.js";

// ── Constants ───────────────────────────────────────────────────────────

const NAMESPACE_SEPARATOR = "__";
const MCP_PREFIX = "mcp";
const MCP_CATEGORY: ToolCategory = "mcp";

// ── Namespacing ─────────────────────────────────────────────────────────

function buildToolName(serverName: string, toolName: string): string {
  return `${MCP_PREFIX}${NAMESPACE_SEPARATOR}${serverName}${NAMESPACE_SEPARATOR}${toolName}`;
}

function parseToolName(
  namespacedName: string,
): { serverName: string; toolName: string } | undefined {
  const parts = namespacedName.split(NAMESPACE_SEPARATOR);
  if (parts.length < 3 || parts[0] !== MCP_PREFIX) {
    return undefined;
  }
  const serverName = parts[1];
  const toolName = parts.slice(2).join(NAMESPACE_SEPARATOR);
  if (!serverName || !toolName) {
    return undefined;
  }
  return { serverName, toolName };
}

// ── Schema Conversion ───────────────────────────────────────────────────

interface IJsonSchemaProperty {
  readonly type?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly enum?: readonly string[];
}

function convertInputSchema(
  inputSchema: Readonly<Record<string, unknown>>,
): readonly IToolParameter[] {
  const properties = inputSchema["properties"];
  if (!properties || typeof properties !== "object") {
    return [];
  }

  const requiredList = inputSchema["required"];
  const requiredSet = new Set<string>(
    Array.isArray(requiredList) ? (requiredList as string[]) : [],
  );

  const params: IToolParameter[] = [];
  for (const [name, rawSchema] of Object.entries(
    properties as Record<string, unknown>,
  )) {
    const schema = rawSchema as IJsonSchemaProperty | undefined;
    if (!schema || typeof schema !== "object") {
      continue;
    }

    const param: IToolParameter = {
      name,
      type: schema.type ?? "string",
      description: schema.description ?? "",
      required: requiredSet.has(name),
      ...(schema.default !== undefined ? { default: schema.default } : {}),
      ...(schema.enum !== undefined ? { enum: schema.enum } : {}),
    };
    params.push(param);
  }

  return params;
}

function mcpToolToDefinition(
  serverName: string,
  mcpTool: IMCPToolSchema,
): IToolDefinition {
  return {
    name: buildToolName(serverName, mcpTool.name),
    description: `[MCP:${serverName}] ${mcpTool.description}`,
    parameters: convertInputSchema(mcpTool.inputSchema),
  };
}

// ── Tool Call Conversion ────────────────────────────────────────────────

interface IMCPCallRequest {
  readonly serverName: string;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
}

function toolCallToMCPRequest(call: IToolCall): IMCPCallRequest {
  const parsed = parseToolName(call.name);
  if (!parsed) {
    throw new ToolCallError(
      call.name,
      "Invalid MCP tool name format — expected mcp__{server}__{tool}",
    );
  }
  return {
    serverName: parsed.serverName,
    toolName: parsed.toolName,
    arguments: call.arguments,
  };
}

function mcpResultToToolResult(
  toolCallId: string,
  toolName: string,
  content: string,
  isError: boolean,
): IToolResult {
  return { toolCallId, name: toolName, content, isError };
}

// ── Argument Validation (PRD 11.4) ──────────────────────────────────────

function validateArguments(
  args: Record<string, unknown>,
  parameters: readonly IToolParameter[],
): string | undefined {
  for (const param of parameters) {
    if (param.required && !(param.name in args)) {
      return `Missing required argument: ${param.name}`;
    }
  }
  return undefined;
}

// ── MCPToolBridge ───────────────────────────────────────────────────────

export class MCPToolBridge {
  private readonly serverManager: MCPServerManager;
  private readonly toolCache = new Map<string, readonly IToolDefinition[]>();

  constructor(serverManager: MCPServerManager) {
    this.serverManager = serverManager;
  }

  /**
   * Discover tools from all connected MCP servers and register them.
   * Uses lazy loading: definitions are fetched and cached on first request.
   */
  async registerAll(registry: IToolRegistry): Promise<number> {
    const servers = this.serverManager.getConnectedServers();
    let totalRegistered = 0;

    for (const serverName of servers) {
      try {
        const count = await this.registerServerTools(serverName, registry);
        totalRegistered += count;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { server: serverName, error: msg },
          "Failed to register MCP tools",
        );
      }
    }

    logger.info(
      { totalRegistered, servers: servers.length },
      "MCP tool registration complete",
    );

    return totalRegistered;
  }

  /**
   * Register tools from a single MCP server.
   * Fetches tool schemas and caches definitions.
   */
  async registerServerTools(
    serverName: string,
    registry: IToolRegistry,
  ): Promise<number> {
    const definitions = await this.loadToolDefinitions(serverName);

    for (const definition of definitions) {
      const registration = this.createRegistration(serverName, definition);
      registry.register(registration);
    }

    logger.info(
      { server: serverName, tools: definitions.length },
      "Registered MCP server tools",
    );

    return definitions.length;
  }

  /**
   * Lazy-load tool definitions for a server.
   * Returns cached definitions if already loaded.
   */
  async loadToolDefinitions(
    serverName: string,
  ): Promise<readonly IToolDefinition[]> {
    const cached = this.toolCache.get(serverName);
    if (cached) {
      return cached;
    }

    const mcpTools = await this.serverManager.listServerTools(serverName);
    const definitions = mcpTools.map((tool) =>
      mcpToolToDefinition(serverName, tool),
    );

    this.toolCache.set(serverName, definitions);
    return definitions;
  }

  /**
   * Execute an MCP tool call: validate, convert, call, return result.
   */
  async executeTool(call: IToolCall): Promise<IToolResult> {
    const request = toolCallToMCPRequest(call);

    // Validate arguments against cached schema
    const definitions = this.toolCache.get(request.serverName);
    if (definitions) {
      const def = definitions.find((d) => d.name === call.name);
      if (def) {
        const validationError = validateArguments(call.arguments, def.parameters);
        if (validationError) {
          return mcpResultToToolResult(call.id, call.name, validationError, true);
        }
      }
    }

    // Rate-limit check
    this.serverManager.checkRateLimitFor(request.serverName);
    this.serverManager.recordCall(request.serverName);

    const client = this.serverManager.getClient(request.serverName);
    if (!client) {
      return mcpResultToToolResult(
        call.id,
        call.name,
        `MCP server "${request.serverName}" is not connected`,
        true,
      );
    }

    try {
      const result = await client.callTool(request.toolName, request.arguments);
      return mcpResultToToolResult(
        call.id,
        call.name,
        result.content,
        result.isError,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return mcpResultToToolResult(call.id, call.name, msg, true);
    }
  }

  /** Invalidate cached tool definitions for a server (e.g. after config reload). */
  invalidateCache(serverName?: string): void {
    if (serverName) {
      this.toolCache.delete(serverName);
    } else {
      this.toolCache.clear();
    }
  }

  /** Check whether a tool name is an MCP-namespaced tool. */
  isMCPTool(toolName: string): boolean {
    return parseToolName(toolName) !== undefined;
  }

  /** Get all cached tool definitions across all servers. */
  getAllDefinitions(): readonly IToolDefinition[] {
    const all: IToolDefinition[] = [];
    for (const defs of this.toolCache.values()) {
      all.push(...defs);
    }
    return all;
  }

  // ── Private ─────────────────────────────────────────────────────────

  private createRegistration(
    _serverName: string,
    definition: IToolDefinition,
  ): IToolRegistration {
    return {
      definition,
      category: MCP_CATEGORY,
      requiresApproval: (mode: PermissionMode, _args: Record<string, unknown>) => {
        // MCP tools always require approval in strict mode
        return mode === "strict";
      },
      execute: async (args: Record<string, unknown>) => {
        const call: IToolCall = {
          id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: definition.name,
          arguments: args,
        };
        return this.executeTool(call);
      },
    };
  }
}
