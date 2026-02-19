/**
 * Plan approval workflow per PRD section 8.2 step 5
 * Agent submits plan → Leader reviews → Approve or reject.
 * Uses message bus for transport; includes configurable timeout.
 */

import { randomUUID } from "node:crypto";
import type { IAgentMessage } from "../types/index.js";
import { logger } from "../utils/index.js";
import type { MessageBus } from "./message-bus.js";

// ── Public Types ──────────────────────────────────────────────────────

/** Result of a plan approval request. */
export interface IPlanApprovalResult {
  readonly approved: boolean;
  readonly feedback?: string | undefined;
  readonly requestId: string;
  readonly respondedBy: string;
  readonly respondedAt: Date;
}

/** A pending plan awaiting leader review (for listing). */
export interface IPendingPlan {
  readonly requestId: string;
  readonly agentId: string;
  readonly plan: string;
  readonly submittedAt: Date;
}

/** Options for the PlanApproval workflow. */
export interface IPlanApprovalOptions {
  readonly leaderId?: string;
  readonly timeoutMs?: number;
}

// ── Internal Types ────────────────────────────────────────────────────

interface IPlanRequest {
  readonly requestId: string;
  readonly agentId: string;
  readonly plan: string;
  readonly submittedAt: Date;
  readonly resolve: (result: IPlanApprovalResult) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const DEFAULT_LEADER_ID = "leader";

// ── PlanApproval ──────────────────────────────────────────────────────

export class PlanApproval {
  private readonly messageBus: MessageBus;
  private readonly leaderId: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, IPlanRequest>();
  private destroyed = false;

  constructor(messageBus: MessageBus, options?: IPlanApprovalOptions) {
    this.messageBus = messageBus;
    this.leaderId = options?.leaderId ?? DEFAULT_LEADER_ID;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Submit a plan for approval. Returns a promise that resolves
   * when the leader approves or rejects, or rejects on timeout.
   */
  submitPlan(agentId: string, plan: string): Promise<IPlanApprovalResult> {
    if (this.destroyed) {
      return Promise.reject(new Error("PlanApproval has been destroyed"));
    }

    const requestId = randomUUID();

    return new Promise<IPlanApprovalResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Plan approval timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      const request: IPlanRequest = {
        requestId,
        agentId,
        plan,
        submittedAt: new Date(),
        resolve,
        reject,
        timer,
      };

      this.pending.set(requestId, request);

      this.messageBus.createAndSend(
        "plan_approval_request",
        agentId,
        this.leaderId,
        plan,
        { requestId, summary: `Plan from ${agentId} awaiting review` },
      );

      logger.info({ requestId, agentId }, "Plan submitted for approval");
    });
  }

  /** Leader approves a pending plan. Returns false if no matching request. */
  approvePlan(requestId: string, responderId: string): boolean {
    const request = this.pending.get(requestId);
    if (!request) {
      logger.warn({ requestId }, "No pending plan for this requestId");
      return false;
    }

    clearTimeout(request.timer);
    this.pending.delete(requestId);

    const result: IPlanApprovalResult = {
      approved: true,
      requestId,
      respondedBy: responderId,
      respondedAt: new Date(),
    };

    this.messageBus.createAndSend(
      "plan_approval_response",
      responderId,
      request.agentId,
      "Plan approved",
      { requestId, approve: true },
    );

    request.resolve(result);
    logger.info({ requestId, agentId: request.agentId }, "Plan approved");
    return true;
  }

  /** Leader rejects a pending plan with feedback. */
  rejectPlan(
    requestId: string,
    responderId: string,
    feedback: string,
  ): boolean {
    const request = this.pending.get(requestId);
    if (!request) {
      logger.warn({ requestId }, "No pending plan for this requestId");
      return false;
    }

    clearTimeout(request.timer);
    this.pending.delete(requestId);

    const result: IPlanApprovalResult = {
      approved: false,
      feedback,
      requestId,
      respondedBy: responderId,
      respondedAt: new Date(),
    };

    this.messageBus.createAndSend(
      "plan_approval_response",
      responderId,
      request.agentId,
      feedback,
      { requestId, approve: false },
    );

    request.resolve(result);
    logger.info(
      { requestId, agentId: request.agentId, feedback },
      "Plan rejected",
    );
    return true;
  }

  /**
   * Handle an incoming plan_approval_response message.
   * Call this from a message bus subscription to close the request loop.
   */
  handleResponse(message: IAgentMessage): void {
    if (message.type !== "plan_approval_response" || !message.requestId) {
      return;
    }

    const request = this.pending.get(message.requestId);
    if (!request) return;

    clearTimeout(request.timer);
    this.pending.delete(message.requestId);

    const result: IPlanApprovalResult = {
      approved: message.approve === true,
      feedback: message.approve === true ? undefined : message.content,
      requestId: message.requestId,
      respondedBy: message.senderId,
      respondedAt: new Date(),
    };

    request.resolve(result);
  }

  /** Cancel a pending plan request. */
  cancelPlan(requestId: string): boolean {
    const request = this.pending.get(requestId);
    if (!request) return false;

    clearTimeout(request.timer);
    this.pending.delete(requestId);
    request.reject(new Error("Plan approval cancelled"));

    logger.info({ requestId, agentId: request.agentId }, "Plan cancelled");
    return true;
  }

  /** Get all pending plan requests (for leader UI). */
  getPendingPlans(): readonly IPendingPlan[] {
    return [...this.pending.values()].map((req) => ({
      requestId: req.requestId,
      agentId: req.agentId,
      plan: req.plan,
      submittedAt: req.submittedAt,
    }));
  }

  /** Get the count of pending plans. */
  getPendingCount(): number {
    return this.pending.size;
  }

  /** Tear down: cancel all pending plans and release resources. */
  destroy(): void {
    this.destroyed = true;

    for (const [, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(new Error("PlanApproval destroyed"));
    }

    this.pending.clear();
    logger.debug("PlanApproval destroyed");
  }
}
