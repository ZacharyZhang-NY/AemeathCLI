/**
 * MCP client per PRD section 11.1
 * Wraps @modelcontextprotocol/sdk Client with typed, transport-agnostic interface.
 * Supports stdio (local servers) and Streamable HTTP (remote servers).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { logger } from "../utils/logger.js";
import { ServerConnectionError, ToolCallError } from "../types/errors.js";

// ── Exported Types ──────────────────────────────────────────────────────

export interface IMCPToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface IMCPCallResult {
  readonly content: string;
  readonly isError: boolean;
}

export interface IMCPResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

// ── Transport Configuration ─────────────────────────────────────────────

export interface IStdioTransportConfig {
  readonly type: "stdio";
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface IHttpTransportConfig {
  readonly type: "streamable-http";
  readonly url: string;
}

export type MCPTransportConfig = IStdioTransportConfig | IHttpTransportConfig;

// ── Client Options ──────────────────────────────────────────────────────

export interface IMCPClientOptions {
  readonly serverName: string;
  readonly transport: MCPTransportConfig;
  readonly connectionTimeoutMs?: number;
}

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const CLIENT_NAME = "aemeathcli";
const CLIENT_VERSION = "1.0.0";

// ── Content Helpers ─────────────────────────────────────────────────────

interface IContentItem {
  readonly type: string;
  readonly text?: string;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "No output";
  }
  const parts: string[] = [];
  for (const item of content as ReadonlyArray<IContentItem>) {
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : "No output";
}

// ── MCPClient ───────────────────────────────────────────────────────────

export class MCPClient {
  private client: Client | undefined;
  private connected = false;
  private readonly serverName: string;
  private readonly transportConfig: MCPTransportConfig;
  private readonly connectionTimeoutMs: number;

  constructor(options: IMCPClientOptions) {
    this.serverName = options.serverName;
    this.transportConfig = options.transport;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get name(): string {
    return this.serverName;
  }

  /** Establish connection to the MCP server. */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    logger.info({ server: this.serverName }, "Connecting to MCP server");

    try {
      this.client = new Client(
        { name: CLIENT_NAME, version: CLIENT_VERSION },
        { capabilities: { sampling: {} } },
      );

      await this.connectWithTimeout();
      this.connected = true;
      logger.info({ server: this.serverName }, "Connected to MCP server");
    } catch (error: unknown) {
      this.connected = false;
      this.client = undefined;
      const msg = error instanceof Error ? error.message : String(error);
      throw new ServerConnectionError(this.serverName, msg);
    }
  }

  /** Gracefully close the MCP connection. */
  async disconnect(): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    logger.info({ server: this.serverName }, "Disconnecting from MCP server");

    try {
      await this.client.close();
    } catch (error: unknown) {
      logger.warn({ server: this.serverName, error }, "Error during MCP disconnect");
    } finally {
      this.connected = false;
      this.client = undefined;
    }
  }

  /** Disconnect then reconnect to the server. */
  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  /** List all tools exposed by this MCP server. */
  async listTools(): Promise<readonly IMCPToolSchema[]> {
    const client = this.requireConnected();

    try {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: (tool.inputSchema ?? {}) as Readonly<Record<string, unknown>>,
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ServerConnectionError(this.serverName, `listTools failed: ${msg}`);
    }
  }

  /** Call a tool on this MCP server with the given arguments. */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<IMCPCallResult> {
    const client = this.requireConnected();

    try {
      const result = await client.callTool({ name: toolName, arguments: args });
      return {
        content: extractText(result.content),
        isError: result.isError === true,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ToolCallError(toolName, msg);
    }
  }

  /** List resources exposed by this MCP server. */
  async listResources(): Promise<readonly IMCPResource[]> {
    const client = this.requireConnected();

    try {
      const result = await client.listResources();
      return result.resources.map((r) => ({
        uri: r.uri,
        name: r.name ?? r.uri,
        description: "",
        mimeType: r.mimeType ?? "application/octet-stream",
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ServerConnectionError(
        this.serverName,
        `listResources failed: ${msg}`,
      );
    }
  }

  /** Read a specific resource by URI. */
  async readResource(uri: string): Promise<string> {
    const client = this.requireConnected();

    try {
      const result = await client.readResource({ uri });
      return extractText(result.contents);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ServerConnectionError(
        this.serverName,
        `readResource(${uri}) failed: ${msg}`,
      );
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────

  private async connectWithTimeout(): Promise<void> {
    const client = this.client;
    if (!client) {
      throw new Error("Client not initialised");
    }

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Connection timed out after ${this.connectionTimeoutMs}ms`,
            ),
          ),
        this.connectionTimeoutMs,
      );
    });

    if (this.transportConfig.type === "stdio") {
      const transport = new StdioClientTransport({
        command: this.transportConfig.command,
        args: [...this.transportConfig.args],
        ...(this.transportConfig.env !== undefined
          ? { env: { ...this.transportConfig.env } }
          : {}),
      });
      await Promise.race([client.connect(transport), timeoutPromise]);
      return;
    }

    if (this.transportConfig.type === "streamable-http") {
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(this.transportConfig.url),
      );
      await Promise.race([client.connect(transport as Transport), timeoutPromise]);
      return;
    }

    // Exhaustiveness guard
    const _exhaustive: never = this.transportConfig;
    throw new ServerConnectionError(
      this.serverName,
      `Unknown transport type: ${JSON.stringify(_exhaustive)}`,
    );
  }

  private requireConnected(): Client {
    if (!this.connected || !this.client) {
      throw new ServerConnectionError(this.serverName, "Not connected");
    }
    return this.client;
  }
}
