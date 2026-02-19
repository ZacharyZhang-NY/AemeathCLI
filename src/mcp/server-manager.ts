/**
 * MCP server lifecycle manager per PRD section 11.1
 * Manages multiple MCP server connections: start, stop, health-check, restart, rate-limit.
 */

import { logger } from "../utils/logger.js";
import { ServerConnectionError } from "../types/errors.js";
import { MCPClient } from "./client.js";
import type { IMCPClientOptions, IMCPToolSchema, IStdioTransportConfig } from "./client.js";
import type { IMCPConfig, IMCPServerConfig } from "../types/config.js";

// ── Server State ────────────────────────────────────────────────────────

type ServerStatus = "stopped" | "connecting" | "connected" | "error";

interface IServerEntry {
  readonly client: MCPClient;
  status: ServerStatus;
  lastHealthCheck: number;
  consecutiveFailures: number;
  readonly rateLimit: IRateLimitState;
}

// ── Rate Limiting ───────────────────────────────────────────────────────

interface IRateLimitState {
  callTimestamps: number[];
  maxCallsPerMinute: number;
}

export interface IRateLimitConfig {
  readonly maxCallsPerMinute: number;
}

// ── Manager Options ─────────────────────────────────────────────────────

export interface IServerManagerOptions {
  readonly connectionTimeoutMs?: number;
  readonly healthCheckIntervalMs?: number;
  readonly maxConsecutiveFailures?: number;
  readonly defaultRateLimit?: IRateLimitConfig | undefined;
  readonly rateLimits?: Readonly<Record<string, IRateLimitConfig>> | undefined;
}

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_HEALTH_INTERVAL_MS = 60_000;
const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_MAX_CALLS_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

// ── MCPServerManager ────────────────────────────────────────────────────

export class MCPServerManager {
  private readonly servers = new Map<string, IServerEntry>();
  private readonly options: Required<
    Pick<IServerManagerOptions, "connectionTimeoutMs" | "healthCheckIntervalMs" | "maxConsecutiveFailures">
  > & Pick<IServerManagerOptions, "defaultRateLimit" | "rateLimits">;
  private healthCheckTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options?: IServerManagerOptions) {
    this.options = {
      connectionTimeoutMs: options?.connectionTimeoutMs ?? 30_000,
      healthCheckIntervalMs: options?.healthCheckIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS,
      maxConsecutiveFailures: options?.maxConsecutiveFailures ?? DEFAULT_MAX_FAILURES,
      defaultRateLimit: options?.defaultRateLimit,
      rateLimits: options?.rateLimits,
    };
  }

  /** Start all servers defined in the MCP config. */
  async startAll(config: IMCPConfig): Promise<void> {
    const entries = Object.entries(config.mcpServers);
    if (entries.length === 0) {
      logger.info("No MCP servers configured");
      return;
    }

    logger.info({ count: entries.length }, "Starting MCP servers");

    const results = await Promise.allSettled(
      entries.map(([name, serverConfig]) => this.startServer(name, serverConfig)),
    );

    let successCount = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        successCount++;
      }
    }

    logger.info(
      { total: entries.length, connected: successCount },
      "MCP server startup complete",
    );

    this.startHealthChecks();
  }

  /** Start a single MCP server by name and config. */
  async startServer(name: string, serverConfig: IMCPServerConfig): Promise<void> {
    if (this.servers.has(name)) {
      logger.warn({ server: name }, "MCP server already registered, stopping first");
      await this.stopServer(name);
    }

    logger.info({ server: name, command: serverConfig.command }, "Starting MCP server");

    const transportConfig: IStdioTransportConfig = {
      type: "stdio",
      command: serverConfig.command,
      args: [...serverConfig.args],
      ...(serverConfig.env !== undefined ? { env: { ...serverConfig.env } } : {}),
    };

    const clientOptions: IMCPClientOptions = {
      serverName: name,
      transport: transportConfig,
      connectionTimeoutMs: this.options.connectionTimeoutMs,
    };

    const client = new MCPClient(clientOptions);
    const maxCalls = this.getMaxCallsPerMinute(name);

    const entry: IServerEntry = {
      client,
      status: "connecting",
      lastHealthCheck: Date.now(),
      consecutiveFailures: 0,
      rateLimit: { callTimestamps: [], maxCallsPerMinute: maxCalls },
    };

    this.servers.set(name, entry);

    try {
      await client.connect();
      entry.status = "connected";
      logger.info({ server: name }, "MCP server connected");
    } catch (error: unknown) {
      entry.status = "error";
      entry.consecutiveFailures = 1;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ server: name, error: msg }, "Failed to start MCP server");
      throw new ServerConnectionError(name, msg);
    }
  }

  /** Stop a single server by name. */
  async stopServer(name: string): Promise<void> {
    const entry = this.servers.get(name);
    if (!entry) {
      return;
    }

    logger.info({ server: name }, "Stopping MCP server");

    try {
      await entry.client.disconnect();
    } catch (error: unknown) {
      logger.warn({ server: name, error }, "Error stopping MCP server");
    }

    entry.status = "stopped";
    this.servers.delete(name);
  }

  /** Stop all managed servers and clean up. */
  async stopAll(): Promise<void> {
    this.stopHealthChecks();

    const names = [...this.servers.keys()];
    logger.info({ count: names.length }, "Stopping all MCP servers");

    await Promise.allSettled(names.map((name) => this.stopServer(name)));
  }

  /** Get a connected client by server name. */
  getClient(name: string): MCPClient | undefined {
    const entry = this.servers.get(name);
    if (!entry || entry.status !== "connected") {
      return undefined;
    }
    return entry.client;
  }

  /** Get all connected server names. */
  getConnectedServers(): readonly string[] {
    const connected: string[] = [];
    for (const [name, entry] of this.servers) {
      if (entry.status === "connected") {
        connected.push(name);
      }
    }
    return connected;
  }

  /** Get the status of a server. */
  getServerStatus(name: string): ServerStatus | undefined {
    return this.servers.get(name)?.status;
  }

  /** List tools from a specific server (with rate-limit check). */
  async listServerTools(name: string): Promise<readonly IMCPToolSchema[]> {
    const entry = this.requireServer(name);
    this.checkRateLimit(entry, name);
    return entry.client.listTools();
  }

  /** Check rate limit before allowing a call to the given server. Throws on exceeded. */
  checkRateLimitFor(name: string): void {
    const entry = this.requireServer(name);
    this.checkRateLimit(entry, name);
  }

  /** Record a tool call for rate-limiting purposes. */
  recordCall(name: string): void {
    const entry = this.servers.get(name);
    if (entry) {
      entry.rateLimit.callTimestamps.push(Date.now());
    }
  }

  // ── Health Checking ─────────────────────────────────────────────────

  private startHealthChecks(): void {
    this.stopHealthChecks();

    this.healthCheckTimer = setInterval(() => {
      void this.runHealthChecks();
    }, this.options.healthCheckIntervalMs);

    // Prevent the timer from keeping the process alive
    if (typeof this.healthCheckTimer === "object" && "unref" in this.healthCheckTimer) {
      this.healthCheckTimer.unref();
    }
  }

  private stopHealthChecks(): void {
    if (this.healthCheckTimer !== undefined) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private async runHealthChecks(): Promise<void> {
    for (const [name, entry] of this.servers) {
      if (entry.status === "stopped") {
        continue;
      }

      try {
        await entry.client.listTools();
        entry.status = "connected";
        entry.consecutiveFailures = 0;
        entry.lastHealthCheck = Date.now();
      } catch {
        entry.consecutiveFailures++;
        entry.status = "error";
        logger.warn(
          { server: name, failures: entry.consecutiveFailures },
          "MCP health check failed",
        );

        if (entry.consecutiveFailures >= this.options.maxConsecutiveFailures) {
          logger.info({ server: name }, "Attempting MCP server restart");
          void this.restartServer(name, entry);
        }
      }
    }
  }

  private async restartServer(name: string, entry: IServerEntry): Promise<void> {
    try {
      await entry.client.reconnect();
      entry.status = "connected";
      entry.consecutiveFailures = 0;
      logger.info({ server: name }, "MCP server restarted successfully");
    } catch (error: unknown) {
      entry.status = "error";
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ server: name, error: msg }, "MCP server restart failed");
    }
  }

  // ── Rate Limiting ─────────────────────────────────────────────────

  private checkRateLimit(entry: IServerEntry, serverName: string): void {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    // Prune timestamps outside the window
    entry.rateLimit.callTimestamps = entry.rateLimit.callTimestamps.filter(
      (ts) => ts > windowStart,
    );

    if (entry.rateLimit.callTimestamps.length >= entry.rateLimit.maxCallsPerMinute) {
      throw new ServerConnectionError(
        serverName,
        `Rate limit exceeded: ${entry.rateLimit.maxCallsPerMinute} calls/minute`,
      );
    }
  }

  private getMaxCallsPerMinute(serverName: string): number {
    const perServer = this.options.rateLimits?.[serverName];
    if (perServer) {
      return perServer.maxCallsPerMinute;
    }
    return this.options.defaultRateLimit?.maxCallsPerMinute ?? DEFAULT_MAX_CALLS_PER_MINUTE;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private requireServer(name: string): IServerEntry {
    const entry = this.servers.get(name);
    if (!entry || entry.status !== "connected") {
      throw new ServerConnectionError(name, "Server not connected");
    }
    return entry;
  }
}
