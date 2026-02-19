/**
 * Inter-agent message routing per PRD section 8.4
 * Supports: DM, broadcast, shutdown, plan approval, task updates.
 * Message queue for busy agents with automatic drain on idle transition.
 */

import { randomUUID } from "node:crypto";
import type {
  IAgentMessage,
  AgentMessageType,
  AgentStatus,
} from "../types/index.js";
import { logger } from "../utils/index.js";
import { getEventBus } from "../core/event-bus.js";

// ── Public Types ──────────────────────────────────────────────────────

/** Handler function invoked when an agent receives a message. */
export type MessageHandler = (message: IAgentMessage) => void;

/**
 * Optional transport layer for remote message delivery (e.g., IPC hub).
 * Implement this interface to bridge the message bus to Unix domain sockets.
 */
export interface IMessageTransport {
  send(agentId: string, message: IAgentMessage): Promise<boolean>;
  onReceive(handler: (message: IAgentMessage) => void): () => void;
}

/** Options for constructing a MessageBus. */
export interface IMessageBusOptions {
  readonly transport?: IMessageTransport;
}

// ── MessageBus ────────────────────────────────────────────────────────

export class MessageBus {
  private readonly handlers = new Map<string, Set<MessageHandler>>();
  private readonly queues = new Map<string, IAgentMessage[]>();
  private readonly statuses = new Map<string, AgentStatus>();
  private readonly transport: IMessageTransport | undefined;
  private readonly transportUnsubscribe: (() => void) | undefined;
  private destroyed = false;

  constructor(options?: IMessageBusOptions) {
    this.transport = options?.transport;

    if (this.transport) {
      this.transportUnsubscribe = this.transport.onReceive((message) => {
        this.routeIncoming(message);
      });
    }
  }

  /** Register an agent as available for message delivery. */
  registerAgent(agentId: string): void {
    if (!this.handlers.has(agentId)) {
      this.handlers.set(agentId, new Set());
    }
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
    this.statuses.set(agentId, "idle");
    logger.debug({ agentId }, "Agent registered on message bus");
  }

  /** Remove an agent from the bus. Pending messages are discarded. */
  unregisterAgent(agentId: string): void {
    this.handlers.delete(agentId);
    this.queues.delete(agentId);
    this.statuses.delete(agentId);
    logger.debug({ agentId }, "Agent unregistered from message bus");
  }

  /** Subscribe to messages delivered to an agent. Returns unsubscribe function. */
  subscribe(agentId: string, handler: MessageHandler): () => void {
    let handlerSet = this.handlers.get(agentId);
    if (!handlerSet) {
      handlerSet = new Set();
      this.handlers.set(agentId, handlerSet);
    }
    handlerSet.add(handler);

    return () => {
      handlerSet.delete(handler);
    };
  }

  /** Route a message to its recipient(s). Returns true if delivered or queued. */
  send(message: IAgentMessage): boolean {
    if (this.destroyed) {
      logger.warn("MessageBus is destroyed, dropping message");
      return false;
    }

    if (message.type === "broadcast") {
      return this.broadcastToAll(message);
    }

    if (!message.recipientId) {
      logger.warn(
        { type: message.type, senderId: message.senderId },
        "Non-broadcast message missing recipientId",
      );
      return false;
    }

    return this.deliverToAgent(message.recipientId, message);
  }

  /** Create a well-formed message and send it. Returns the created message. */
  createAndSend(
    type: AgentMessageType,
    senderId: string,
    recipientId: string | undefined,
    content: string,
    extra?: {
      summary?: string;
      requestId?: string;
      approve?: boolean;
    },
  ): IAgentMessage {
    const message: IAgentMessage = {
      type,
      senderId,
      recipientId,
      content,
      summary: extra?.summary,
      requestId: extra?.requestId ?? randomUUID(),
      approve: extra?.approve,
      timestamp: new Date(),
    };

    this.send(message);
    return message;
  }

  /** Update an agent's status. Drains the queue when transitioning to idle. */
  setAgentStatus(agentId: string, status: AgentStatus): void {
    const previous = this.statuses.get(agentId);
    this.statuses.set(agentId, status);

    if (status === "idle" && previous === "active") {
      this.drainQueue(agentId);
    }
  }

  /** Get the number of queued messages for an agent. */
  getQueueSize(agentId: string): number {
    return this.queues.get(agentId)?.length ?? 0;
  }

  /** Get all registered agent IDs. */
  getRegisteredAgents(): readonly string[] {
    return [...this.handlers.keys()];
  }

  /** Tear down the message bus and release resources. */
  destroy(): void {
    this.destroyed = true;
    this.transportUnsubscribe?.();
    this.handlers.clear();
    this.queues.clear();
    this.statuses.clear();
    logger.debug("MessageBus destroyed");
  }

  // ── Private Routing ─────────────────────────────────────────────────

  private broadcastToAll(message: IAgentMessage): boolean {
    let delivered = false;

    for (const agentId of this.handlers.keys()) {
      if (agentId === message.senderId) continue;

      const copy: IAgentMessage = { ...message, recipientId: agentId };
      this.deliverToAgent(agentId, copy);
      delivered = true;
    }

    return delivered;
  }

  private deliverToAgent(agentId: string, message: IAgentMessage): boolean {
    const status = this.statuses.get(agentId);

    // Queue if agent is busy
    if (status === "active") {
      this.enqueue(agentId, message);
      logger.debug(
        { agentId, type: message.type },
        "Agent busy, message queued",
      );
      return true;
    }

    // Try local handler delivery
    const handlerSet = this.handlers.get(agentId);
    if (handlerSet && handlerSet.size > 0) {
      this.invokeHandlers(agentId, handlerSet, message);
      return true;
    }

    // Try remote transport
    if (this.transport) {
      this.transport.send(agentId, message).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error({ agentId, error: reason }, "Transport delivery failed");
      });
      return true;
    }

    // No handler and no transport — queue for later
    this.enqueue(agentId, message);
    return true;
  }

  private invokeHandlers(
    agentId: string,
    handlerSet: Set<MessageHandler>,
    message: IAgentMessage,
  ): void {
    for (const handler of handlerSet) {
      try {
        handler(message);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error({ agentId, error: reason }, "Message handler threw");
      }
    }

    getEventBus().emit("agent:message", {
      from: message.senderId,
      to: agentId,
      content: message.content,
    });
  }

  private enqueue(agentId: string, message: IAgentMessage): void {
    let queue = this.queues.get(agentId);
    if (!queue) {
      queue = [];
      this.queues.set(agentId, queue);
    }
    queue.push(message);
  }

  private drainQueue(agentId: string): void {
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) return;

    const handlerSet = this.handlers.get(agentId);
    if (!handlerSet || handlerSet.size === 0) return;

    const pending = queue.splice(0);
    logger.debug({ agentId, count: pending.length }, "Draining message queue");

    for (const message of pending) {
      this.invokeHandlers(agentId, handlerSet, message);
    }
  }

  private routeIncoming(message: IAgentMessage): void {
    if (message.type === "broadcast") {
      this.broadcastToAll(message);
    } else if (message.recipientId) {
      this.deliverToAgent(message.recipientId, message);
    }
  }
}
