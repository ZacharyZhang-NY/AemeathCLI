/**
 * PaneProcess — IPC client connecting to the IPCHub from an agent process.
 * JSON-RPC 2.0 with HMAC auth, reconnection, and heartbeat per PRD 9.4 & 20.2.
 */

import { connect, type Socket } from "node:net";
import { createHmac } from "node:crypto";
import type { IIPCMessage, IIPCResponse, IPCMethod } from "../types/team.js";
import { logger } from "../utils/logger.js";
import { IPCError } from "../types/errors.js";
import { withRetry, sleep } from "../utils/retry.js";

// ── Types ───────────────────────────────────────────────────────────────

interface IPaneProcessOptions {
  readonly agentId: string;
  readonly agentName: string;
  readonly socketPath: string;
  readonly hmacSecret: string;
  readonly heartbeatIntervalMs?: number;
  readonly reconnectMaxRetries?: number;
}

type MessageHandler = (message: IIPCMessage) => void;
type PendingRequest = {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_RECONNECT_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const NEWLINE = 0x0a;

// ── PaneProcess ─────────────────────────────────────────────────────────

export class PaneProcess {
  private readonly agentId: string;
  private readonly agentName: string;
  private readonly socketPath: string;
  private readonly hmacSecret: string;
  private readonly heartbeatMs: number;
  private readonly maxRetries: number;
  private readonly msgHandlers = new Map<string, Set<MessageHandler>>();
  private readonly pending = new Map<number, PendingRequest>();

  private socket: Socket | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private nextId = 1;
  private connected = false;
  private disposed = false;

  constructor(options: IPaneProcessOptions) {
    this.agentId = options.agentId;
    this.agentName = options.agentName;
    this.socketPath = options.socketPath;
    this.hmacSecret = options.hmacSecret;
    this.heartbeatMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this.maxRetries = options.reconnectMaxRetries ?? DEFAULT_RECONNECT_RETRIES;
  }

  /** Connect to the IPC hub and register this agent. */
  async connect(): Promise<void> {
    this.assertAlive();
    await this.establish();
    await this.register();
    this.startHeartbeat();
    logger.info({ agentId: this.agentId }, "PaneProcess connected");
  }

  /** Send a JSON-RPC 2.0 request and wait for response. */
  async request(method: IPCMethod, params: Record<string, unknown>): Promise<unknown> {
    this.assertAlive();
    this.assertConnected();
    const id = this.nextId++;
    const message: IIPCMessage = { jsonrpc: "2.0", method, params: { ...params, agentId: this.agentId }, id };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new IPCError(`Request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.sendAuthenticated(message);
    });
  }

  /** Send a notification (no response expected). */
  notify(method: IPCMethod, params: Record<string, unknown>): void {
    this.assertAlive();
    this.assertConnected();
    this.sendAuthenticated({ jsonrpc: "2.0", method, params: { ...params, agentId: this.agentId } });
  }

  /** Convenience: send a stream chunk. */
  sendStreamChunk(content: string, model: string, taskId?: string): void {
    this.notify("agent.streamChunk", { content, model, taskId });
  }

  /** Convenience: send a task status update. */
  sendTaskUpdate(taskId: string, status: string): void {
    this.notify("agent.taskUpdate", { taskId, status });
  }

  /** Convenience: send a message to another agent via the hub. */
  async sendMessage(to: string, content: string): Promise<unknown> {
    return this.request("agent.message", { from: this.agentId, to, content });
  }

  /** Register a handler for incoming messages of a specific method. */
  onMessage(method: string, handler: MessageHandler): () => void {
    const set = this.msgHandlers.get(method) ?? new Set();
    set.add(handler);
    this.msgHandlers.set(method, set);
    return () => { set.delete(handler); if (set.size === 0) this.msgHandlers.delete(method); };
  }

  isConnected(): boolean { return this.connected && !this.disposed; }

  /** Gracefully disconnect from the hub. */
  async disconnect(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopHeartbeat();
    this.rejectAll();
    if (this.socket) { this.socket.end(); this.socket = undefined; }
    this.connected = false;
    logger.info({ agentId: this.agentId }, "PaneProcess disconnected");
  }

  // ── Connection ────────────────────────────────────────────────────

  private async establish(): Promise<void> {
    await withRetry(() => this.connectSocket(), {
      maxRetries: this.maxRetries,
      baseDelayMs: 500,
      maxDelayMs: 10_000,
      shouldRetry: () => !this.disposed,
    });
  }

  private connectSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = connect(this.socketPath);
      let buffer = Buffer.alloc(0);

      socket.on("connect", () => {
        this.socket = socket;
        this.connected = true;
        resolve();
      });

      socket.on("data", (data: Buffer) => {
        buffer = Buffer.concat([buffer, data]);
        let idx: number;
        while ((idx = buffer.indexOf(NEWLINE)) !== -1) {
          const raw = buffer.subarray(0, idx).toString("utf-8");
          buffer = buffer.subarray(idx + 1);
          if (raw.length > 0) this.handleIncoming(raw);
        }
      });

      socket.on("close", () => {
        this.connected = false;
        if (!this.disposed) {
          logger.warn({ agentId: this.agentId }, "Connection lost, reconnecting");
          this.attemptReconnect();
        }
      });

      socket.on("error", (err: Error) => {
        if (!this.connected) reject(new IPCError(`Connection failed: ${err.message}`));
        else logger.error({ agentId: this.agentId, error: err.message }, "Socket error");
      });
    });
  }

  private async attemptReconnect(): Promise<void> {
    if (this.disposed) return;
    this.stopHeartbeat();
    try {
      await sleep(1_000);
      await this.establish();
      await this.register();
      this.startHeartbeat();
      logger.info({ agentId: this.agentId }, "Reconnected");
    } catch (e: unknown) {
      logger.error({ agentId: this.agentId, error: e instanceof Error ? e.message : String(e) }, "Reconnect failed");
    }
  }

  private async register(): Promise<void> {
    await this.request("agent.register", { agentId: this.agentId, agentName: this.agentName });
  }

  // ── Message Processing ────────────────────────────────────────────

  private handleIncoming(raw: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(raw) as unknown; } catch { return; }

    if (this.isResponse(parsed)) { this.resolveResponse(parsed); return; }
    if (this.isMessage(parsed)) { this.dispatch(parsed); return; }
  }

  private resolveResponse(response: IIPCResponse): void {
    const p = this.pending.get(response.id);
    if (!p) return;
    this.pending.delete(response.id);
    clearTimeout(p.timer);
    if (response.error) p.reject(new IPCError(`RPC ${response.error.code}: ${response.error.message}`));
    else p.resolve(response.result);
  }

  private dispatch(message: IIPCMessage): void {
    const handlers = this.msgHandlers.get(message.method);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(message); } catch (e: unknown) {
        logger.error({ method: message.method, error: e instanceof Error ? e.message : String(e) }, "Handler error");
      }
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.socket && !this.socket.destroyed) {
        this.notify("agent.streamChunk", { content: "", model: "heartbeat", heartbeat: true });
      }
    }, this.heartbeatMs);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
  }

  // ── HMAC ──────────────────────────────────────────────────────────

  private sendAuthenticated(message: IIPCMessage): void {
    if (!this.socket || this.socket.destroyed) return;
    const hmac = createHmac("sha256", this.hmacSecret).update(JSON.stringify(message)).digest("hex");
    this.socket.write(JSON.stringify({ message, hmac }) + "\n");
  }

  // ── Type Guards ───────────────────────────────────────────────────

  private isResponse(v: unknown): v is IIPCResponse {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    return o["jsonrpc"] === "2.0" && typeof o["id"] === "number" && !("method" in o);
  }

  private isMessage(v: unknown): v is IIPCMessage {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    return o["jsonrpc"] === "2.0" && typeof o["method"] === "string";
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private rejectAll(): void {
    const err = new IPCError("PaneProcess disconnected");
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  private assertAlive(): void { if (this.disposed) throw new IPCError("PaneProcess disposed"); }
  private assertConnected(): void { if (!this.connected || !this.socket) throw new IPCError("Not connected"); }
}
