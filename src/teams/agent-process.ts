/**
 * Agent subprocess management per PRD sections 8.1, 9.4
 * Each agent runs as a separate Node.js process (fork of aemeathcli).
 * Parent–child IPC uses JSON-RPC 2.0 protocol (IIPCMessage).
 */

import { fork, type ChildProcess } from "node:child_process";
import type {
  IAgentConfig,
  IAgentState,
  AgentStatus,
  IPCMethod,
  IIPCMessage,
} from "../types/index.js";
import { AgentSpawnError } from "../types/index.js";
import { logger, getIPCSocketPath } from "../utils/index.js";
import { getEventBus } from "../core/event-bus.js";

// ── Public Types ──────────────────────────────────────────────────────

/** Configuration for spawning an agent process. */
export interface IAgentProcessOptions {
  readonly teamName: string;
  readonly sessionId: string;
  readonly cliEntryPoint?: string | undefined;
  readonly env?: Readonly<Record<string, string>>;
  readonly shutdownTimeoutMs?: number;
  readonly registrationTimeoutMs?: number;
}

/** Callback for IPC messages received from the child process. */
export type AgentMessageCallback = (
  method: string,
  params: Record<string, unknown>,
) => void;

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const DEFAULT_REGISTRATION_TIMEOUT_MS = 15_000;

// ── AgentProcess ──────────────────────────────────────────────────────

export class AgentProcess {
  private readonly config: IAgentConfig;
  private readonly teamName: string;
  private readonly sessionId: string;
  private readonly cliEntryPoint: string;
  private readonly customEnv: Readonly<Record<string, string>>;
  private readonly shutdownTimeoutMs: number;
  private readonly registrationTimeoutMs: number;
  private readonly messageCallbacks = new Set<AgentMessageCallback>();

  private child: ChildProcess | null = null;
  private status: AgentStatus = "idle";
  private currentTaskId: string | undefined;
  private nextMessageId = 1;

  constructor(config: IAgentConfig, options: IAgentProcessOptions) {
    this.config = config;
    this.teamName = options.teamName;
    this.sessionId = options.sessionId;
    this.cliEntryPoint =
      options.cliEntryPoint ?? process.argv[1] ?? "aemeathcli";
    this.customEnv = options.env ?? {};
    this.shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.registrationTimeoutMs =
      options.registrationTimeoutMs ?? DEFAULT_REGISTRATION_TIMEOUT_MS;
  }

  /** Spawn the child process. Throws AgentSpawnError on failure. */
  async start(): Promise<void> {
    if (this.child) {
      throw new AgentSpawnError(
        this.config.name,
        "Agent process already running",
      );
    }

    const args = [
      "--agent",
      "--team",
      this.teamName,
      "--name",
      this.config.name,
      "--model",
      this.config.model,
      "--role",
      this.config.role,
    ];

    const socketPath = getIPCSocketPath(this.sessionId);

    const env: Record<string, string | undefined> = {
      ...process.env,
      ...this.customEnv,
      AEMEATHCLI_AGENT_MODE: "1",
      AEMEATHCLI_TEAM_NAME: this.teamName,
      AEMEATHCLI_AGENT_ID: this.config.agentId,
      AEMEATHCLI_AGENT_NAME: this.config.name,
      AEMEATHCLI_IPC_SOCKET: socketPath,
      // Prefer SDK adapters when API keys are available (not OAuth/native login).
      // Native login credentials always use native CLI adapters regardless of
      // this flag — the registry enforces this to avoid "invalid API key" errors.
      AEMEATHCLI_PREFER_SDK: "1",
      // Increase timeout for native CLI fallback (agent tasks can be long).
      AEMEATHCLI_NATIVE_CLI_TIMEOUT_MS: "300000",
    };

    try {
      this.child = fork(this.cliEntryPoint, args, {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        env,
        detached: false,
      });

      this.setupChildListeners();
      this.setStatus("idle");

      await this.waitForRegistration();

      getEventBus().emit("agent:spawned", {
        agentName: this.config.name,
        model: this.config.model,
      });

      logger.info(
        {
          agent: this.config.name,
          pid: this.child.pid,
          model: this.config.model,
        },
        "Agent process spawned",
      );
    } catch (error: unknown) {
      // Kill orphaned child on startup failure
      if (this.child) {
        this.child.kill("SIGTERM");
        this.child = null;
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new AgentSpawnError(this.config.name, reason);
    }
  }

  /** Gracefully stop the agent. Falls back to SIGTERM after timeout. */
  async stop(): Promise<void> {
    if (!this.child) return;

    const child = this.child;

    this.sendIPC("hub.shutdown", { reason: "team_cleanup" });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) {
          logger.warn(
            { agent: this.config.name },
            "Force-killing unresponsive agent",
          );
          child.kill("SIGTERM");
        }
        resolve();
      }, this.shutdownTimeoutMs);

      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    this.cleanup();
    logger.info({ agent: this.config.name }, "Agent process stopped");
  }

  /** Kill and restart the agent process. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Send a JSON-RPC 2.0 message to the child process. Returns message ID. */
  sendIPC(method: IPCMethod, params: Record<string, unknown>): number {
    if (!this.child?.connected) {
      logger.warn(
        { agent: this.config.name, method },
        "Cannot send IPC: child not connected",
      );
      return -1;
    }

    const id = this.nextMessageId++;
    const message: IIPCMessage = {
      jsonrpc: "2.0",
      method,
      params,
      id,
    };

    this.child.send(message);
    return id;
  }

  /** Assign a task to this agent via IPC. */
  assignTask(taskId: string, subject: string, description: string): number {
    this.currentTaskId = taskId;
    return this.sendIPC("hub.taskAssign", { taskId, subject, description });
  }

  /** Register a callback for IPC messages from the child process. */
  onMessage(callback: AgentMessageCallback): () => void {
    this.messageCallbacks.add(callback);
    return () => {
      this.messageCallbacks.delete(callback);
    };
  }

  /** Get the current agent state snapshot. */
  getState(): IAgentState {
    return {
      config: this.config,
      status: this.status,
      currentTaskId: this.currentTaskId,
    };
  }

  /** Get the current status. */
  getStatus(): AgentStatus {
    return this.status;
  }

  /** Get the child process PID, or undefined if not running. */
  getPid(): number | undefined {
    return this.child?.pid;
  }

  /** Check if the child process is alive. */
  isAlive(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private setupChildListeners(): void {
    const child = this.child;
    if (!child) return;

    // Do NOT forward child stdout as agent.streamChunk.
    // The agent child sends all structured output via IPC (process.send).
    // Forwarding stdout captures raw noise from subprocess execution
    // (e.g. native CLI adapters shelling out to codex/gemini/claude).
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const content = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      if (content.length > 0) {
        logger.debug(
          { agent: this.config.name, bytes: content.length },
          "Agent stdout (suppressed from UI)",
        );
      }
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const content = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      if (content.length > 0) {
        logger.warn(
          { agent: this.config.name, stderr: content.slice(0, 200) },
          "Agent stderr",
        );
      }
    });

    child.on("message", (raw: unknown) => {
      this.handleChildMessage(raw);
    });

    child.on("error", (error: Error) => {
      logger.error(
        { agent: this.config.name, error: error.message },
        "Agent process error",
      );
      this.setStatus("error");
    });

    child.on("exit", (code: number | null, signal: string | null) => {
      logger.info(
        { agent: this.config.name, code, signal },
        "Agent process exited",
      );
      this.setStatus("shutdown");
      this.child = null;
    });

    child.on("disconnect", () => {
      logger.debug({ agent: this.config.name }, "Agent IPC disconnected");
    });
  }

  private handleChildMessage(raw: unknown): void {
    if (!isIPCMessage(raw)) {
      logger.warn(
        { agent: this.config.name },
        "Received non-IPC message from child",
      );
      return;
    }

    const { method, params } = raw;

    // Handle known methods internally
    switch (method) {
      case "agent.register":
        logger.debug({ agent: this.config.name }, "Agent registered via IPC");
        break;

      case "agent.taskUpdate": {
        const taskStatus = params["status"];
        if (typeof taskStatus === "string") {
          if (taskStatus === "in_progress") {
            this.setStatus("active");
          } else if (taskStatus === "completed") {
            this.currentTaskId = undefined;
            this.setStatus("idle");
          }
        }
        break;
      }

      case "agent.streamChunk":
      case "agent.message":
        // Forwarded to registered callbacks below
        break;

      default:
        break;
    }

    this.notifyCallbacks(method, params);
  }

  /** Wait for the child to send agent.register. Rejects on timeout or early exit. */
  private async waitForRegistration(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.child?.removeListener("message", onMessage);
        reject(new Error("Agent registration timeout"));
      }, this.registrationTimeoutMs);

      const onMessage = (raw: unknown): void => {
        if (isIPCMessage(raw) && raw.method === "agent.register") {
          clearTimeout(timeout);
          this.child?.removeListener("message", onMessage);
          this.child?.removeListener("exit", onExit);
          resolve();
        }
      };

      const onExit = (): void => {
        clearTimeout(timeout);
        this.child?.removeListener("message", onMessage);
        reject(new Error("Agent process exited before registration"));
      };

      this.child?.on("message", onMessage);
      this.child?.once("exit", onExit);
    });
  }

  private setStatus(status: AgentStatus): void {
    this.status = status;
    getEventBus().emit("agent:status", {
      agentName: this.config.name,
      status,
    });
  }

  private notifyCallbacks(method: string, params: Record<string, unknown>): void {
    for (const callback of this.messageCallbacks) {
      try {
        callback(method, params);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error(
          { agent: this.config.name, error: reason },
          "Message callback threw",
        );
      }
    }
  }

  private cleanup(): void {
    this.child = null;
    this.currentTaskId = undefined;
    this.messageCallbacks.clear();
  }
}

// ── Type Guard ─────────────────────────────────────────────────────────

function isIPCMessage(value: unknown): value is IIPCMessage {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj["jsonrpc"] === "2.0" &&
    typeof obj["method"] === "string" &&
    typeof obj["params"] === "object" &&
    obj["params"] !== null
  );
}
