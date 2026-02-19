/**
 * IPCHub — Unix domain socket server for inter-agent communication.
 * JSON-RPC 2.0 protocol with HMAC authentication per PRD section 9.4 & 14.5.
 */

import { createServer, type Server, type Socket } from "node:net";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, unlink } from "node:fs/promises";
import type { IIPCMessage, IIPCResponse } from "../types/team.js";
import { getIPCSocketDir, getIPCSocketPath, ensureSecureDirectory } from "../utils/pathResolver.js";
import { getEventBus } from "../core/event-bus.js";
import { logger } from "../utils/logger.js";
import { IPCError } from "../types/errors.js";

// ── Types ───────────────────────────────────────────────────────────────

interface IRegisteredClient {
  readonly agentId: string;
  readonly agentName: string;
  readonly socket: Socket;
}

type MethodHandler = (
  clientId: string, params: Record<string, unknown>,
  id: number | undefined, socket: Socket,
) => Promise<unknown>;

// ── Constants ───────────────────────────────────────────────────────────

const NEWLINE = 0x0a;
const SOCKET_PERMS = 0o700;
const MAX_MSG_SIZE = 1_048_576;
const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQ = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INTERNAL_ERROR = -32603;
const RPC_AUTH_ERROR = -32000;

// ── IPCHub ──────────────────────────────────────────────────────────────

export class IPCHub {
  private readonly sessionId: string;
  private readonly hmacSecret: string;
  private readonly socketPath: string;
  private readonly clients = new Map<string, IRegisteredClient>();
  private readonly handlers = new Map<string, MethodHandler>();
  private server: Server | undefined;
  private disposed = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.hmacSecret = randomBytes(32).toString("hex");
    this.socketPath = getIPCSocketPath(sessionId);
    this.registerDefaultHandlers();
  }

  getHmacSecret(): string { return this.hmacSecret; }
  getSocketPath(): string { return this.socketPath; }
  getClientCount(): number { return this.clients.size; }
  getConnectedAgentIds(): readonly string[] { return [...this.clients.keys()]; }

  /** Start the Unix domain socket server. */
  async start(): Promise<void> {
    this.assertAlive();
    ensureSecureDirectory(getIPCSocketDir());
    await this.removeStaleSocket();

    return new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));
      this.server.on("error", (err: Error) => {
        logger.error({ error: err.message }, "IPC server error");
        reject(new IPCError(`Server error: ${err.message}`));
      });
      this.server.listen(this.socketPath, async () => {
        try { await chmod(this.socketPath, SOCKET_PERMS); } catch { /* non-fatal */ }
        logger.info({ socketPath: this.socketPath }, "IPC hub listening");
        this.setupProcessCleanup();
        resolve();
      });
    });
  }

  /** Send a message to a specific registered client. */
  sendToClient(agentId: string, message: IIPCMessage): void {
    this.assertAlive();
    const client = this.clients.get(agentId);
    if (client) this.write(client.socket, message);
  }

  /** Broadcast a message to all connected clients. */
  broadcast(message: IIPCMessage, excludeId?: string): void {
    this.assertAlive();
    for (const [id, client] of this.clients) {
      if (id !== excludeId) this.write(client.socket, message);
    }
  }

  /** Register a custom method handler. */
  onMethod(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  /** Compute HMAC-SHA256 for a message. */
  computeHmac(message: IIPCMessage): string {
    return createHmac("sha256", this.hmacSecret)
      .update(JSON.stringify(message)).digest("hex");
  }

  /** Register a connected socket as a client (also called by agent.register). */
  registerClientSocket(agentId: string, agentName: string, socket: Socket): void {
    this.clients.set(agentId, { agentId, agentName, socket });
  }

  /** Gracefully shut down the hub and all connections. */
  async destroy(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const msg: IIPCMessage = { jsonrpc: "2.0", method: "hub.shutdown", params: { reason: "Hub shutting down" } };
    for (const c of this.clients.values()) {
      try { this.write(c.socket, msg); c.socket.end(); } catch { /* already gone */ }
    }
    this.clients.clear();
    if (this.server) {
      await new Promise<void>((r) => { this.server!.close(() => r()); });
      this.server = undefined;
    }
    await this.removeStaleSocket();
    logger.info({ sessionId: this.sessionId }, "IPC hub destroyed");
  }

  // ── Connection Handling ───────────────────────────────────────────

  private handleConnection(socket: Socket): void {
    let buffer = Buffer.alloc(0);
    let agentId: string | undefined;

    socket.on("data", (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length > MAX_MSG_SIZE) { socket.destroy(); return; }

      let idx: number;
      while ((idx = buffer.indexOf(NEWLINE)) !== -1) {
        const raw = buffer.subarray(0, idx).toString("utf-8");
        buffer = buffer.subarray(idx + 1);
        if (raw.length === 0) continue;
        this.processRaw(raw, socket, agentId).then((id) => { if (id) agentId = id; })
          .catch((e: unknown) => {
            logger.error({ error: e instanceof Error ? e.message : String(e) }, "IPC msg error");
          });
      }
    });

    socket.on("close", () => {
      if (agentId) { this.clients.delete(agentId); logger.info({ agentId }, "Client disconnected"); }
    });
    socket.on("error", (err: Error) => {
      logger.error({ error: err.message, agentId }, "Socket error");
    });
  }

  private async processRaw(raw: string, socket: Socket, currentId: string | undefined): Promise<string | undefined> {
    let parsed: unknown;
    try { parsed = JSON.parse(raw) as unknown; } catch {
      this.sendError(socket, undefined, RPC_PARSE_ERROR, "Parse error"); return undefined;
    }

    if (!this.isAuthEnvelope(parsed)) {
      this.sendError(socket, undefined, RPC_INVALID_REQ, "Invalid request format"); return undefined;
    }
    const { message, hmac } = parsed;

    if (!this.verifyHmac(message, hmac)) {
      this.sendError(socket, message.id, RPC_AUTH_ERROR, "Authentication failed"); return undefined;
    }
    if (message.jsonrpc !== "2.0" || !message.method) {
      this.sendError(socket, message.id, RPC_INVALID_REQ, "Invalid JSON-RPC 2.0"); return undefined;
    }

    const handler = this.handlers.get(message.method);
    if (!handler) {
      this.sendError(socket, message.id, RPC_METHOD_NOT_FOUND, `Unknown: ${message.method}`); return undefined;
    }

    try {
      const aid = currentId ?? (message.params["agentId"] as string | undefined) ?? "unknown";
      const result = await handler(aid, message.params, message.id, socket);
      if (message.id !== undefined) this.sendResult(socket, message.id, result);
      if (message.method === "agent.register") return message.params["agentId"] as string | undefined;
    } catch (e: unknown) {
      this.sendError(socket, message.id, RPC_INTERNAL_ERROR, e instanceof Error ? e.message : String(e));
    }
    return undefined;
  }

  // ── Default Handlers ──────────────────────────────────────────────

  private registerDefaultHandlers(): void {
    this.handlers.set("agent.register", async (_cid, params, _id, socket) => {
      const agentId = params["agentId"] as string | undefined;
      const agentName = params["agentName"] as string | undefined;
      if (!agentId || !agentName) throw new IPCError("agent.register requires agentId and agentName");
      this.registerClientSocket(agentId, agentName, socket);
      logger.info({ agentId, agentName }, "Agent registered");
      return { registered: true, agentId };
    });

    this.handlers.set("agent.streamChunk", async (_cid, params) => {
      getEventBus().emit("model:stream:chunk", {
        model: (params["model"] as string | undefined) ?? "unknown",
        content: (params["content"] as string | undefined) ?? "",
      });
      return { received: true };
    });

    this.handlers.set("agent.taskUpdate", async (_cid, params) => {
      const taskId = params["taskId"] as string | undefined;
      const status = params["status"] as string | undefined;
      if (taskId && status) getEventBus().emit("task:updated", { taskId, status });
      return { received: true };
    });

    this.handlers.set("agent.message", async (_cid, params) => {
      const to = params["to"] as string | undefined;
      const content = params["content"] as string | undefined;
      const from = params["from"] as string | undefined;
      if (from && to && content) {
        getEventBus().emit("agent:message", { from, to, content });
        const target = this.clients.get(to);
        if (target) {
          this.write(target.socket, { jsonrpc: "2.0", method: "agent.message", params: { from, content } });
        }
      }
      return { delivered: this.clients.has(to ?? "") };
    });

    this.handlers.set("hub.taskAssign", async (_cid, params) => {
      const agentId = params["agentId"] as string | undefined;
      const taskId = params["taskId"] as string | undefined;
      if (agentId && taskId) {
        const target = this.clients.get(agentId);
        if (target) this.write(target.socket, { jsonrpc: "2.0", method: "hub.taskAssign", params: { taskId, ...params } });
      }
      return { assigned: this.clients.has(agentId ?? "") };
    });

    this.handlers.set("hub.shutdown", async (_cid, params) => {
      const agentId = params["agentId"] as string | undefined;
      if (agentId) {
        const target = this.clients.get(agentId);
        if (target) {
          this.write(target.socket, {
            jsonrpc: "2.0", method: "hub.shutdown",
            params: { reason: (params["reason"] as string | undefined) ?? "Shutdown requested" },
          });
        }
      }
      return { notified: this.clients.has(agentId ?? "") };
    });
  }

  // ── HMAC ──────────────────────────────────────────────────────────

  private verifyHmac(message: IIPCMessage, hmac: string): boolean {
    const expected = this.computeHmac(message);
    if (expected.length !== hmac.length) return false;
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"));
  }

  private isAuthEnvelope(v: unknown): v is { message: IIPCMessage; hmac: string } {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    return typeof o["hmac"] === "string" && typeof o["message"] === "object" && o["message"] !== null;
  }

  // ── I/O ───────────────────────────────────────────────────────────

  private write(socket: Socket, msg: IIPCMessage | IIPCResponse): void {
    if (!socket.destroyed) socket.write(JSON.stringify(msg) + "\n");
  }

  private sendResult(socket: Socket, id: number, result: unknown): void {
    this.write(socket, { jsonrpc: "2.0", result, id } as IIPCResponse);
  }

  private sendError(socket: Socket, id: number | undefined, code: number, message: string): void {
    this.write(socket, { jsonrpc: "2.0", error: { code, message }, id: id ?? 0 } as IIPCResponse);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  private async removeStaleSocket(): Promise<void> {
    try { await unlink(this.socketPath); } catch { /* may not exist */ }
  }

  private setupProcessCleanup(): void {
    const cleanup = (): void => { this.destroy().catch(() => {}); };
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }

  private assertAlive(): void {
    if (this.disposed) throw new IPCError("IPCHub has been disposed");
  }
}
