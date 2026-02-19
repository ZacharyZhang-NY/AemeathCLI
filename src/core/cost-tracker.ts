/**
 * Real-time cost tracking per PRD section 7.5
 * - Per-request cost calculation
 * - Session total
 * - Breakdown by provider, model, and role
 * - Configurable budget alerts
 */

import type { ProviderName, ModelRole, ITokenUsage, ICostConfig } from "../types/index.js";
import { createTokenUsage, formatCost } from "../utils/index.js";
import { logger } from "../utils/index.js";
import { getEventBus } from "./event-bus.js";

interface ICostEntry {
  readonly provider: ProviderName;
  readonly model: string;
  readonly role?: ModelRole | undefined;
  readonly usage: ITokenUsage;
  readonly timestamp: Date;
}

interface ICostBreakdown {
  readonly byProvider: Record<string, number>;
  readonly byModel: Record<string, number>;
  readonly byRole: Record<string, number>;
}

export class CostTracker {
  private readonly entries: ICostEntry[] = [];
  private readonly budgetConfig: ICostConfig;
  private warningEmitted = false;

  constructor(budgetConfig: ICostConfig) {
    this.budgetConfig = budgetConfig;
  }

  /**
   * Record a cost entry from a model response.
   */
  record(
    provider: ProviderName,
    model: string,
    inputTokens: number,
    outputTokens: number,
    role?: ModelRole,
  ): ITokenUsage {
    const usage = createTokenUsage(model, inputTokens, outputTokens);

    const entry: ICostEntry = {
      provider,
      model,
      role,
      usage,
      timestamp: new Date(),
    };

    this.entries.push(entry);

    const total = this.getSessionTotal();
    const eventBus = getEventBus();

    eventBus.emit("cost:updated", {
      total,
      provider,
      delta: usage.costUsd,
    });

    // Budget warning
    if (total >= this.budgetConfig.budgetWarning && !this.warningEmitted) {
      this.warningEmitted = true;
      eventBus.emit("cost:warning", {
        current: total,
        limit: this.budgetConfig.budgetWarning,
      });
      logger.warn(
        { current: formatCost(total), warning: formatCost(this.budgetConfig.budgetWarning) },
        "Budget warning threshold reached",
      );
    }

    // Budget hard stop
    if (total >= this.budgetConfig.budgetHardStop) {
      eventBus.emit("cost:exceeded", {
        current: total,
        limit: this.budgetConfig.budgetHardStop,
      });
      logger.error(
        { current: formatCost(total), limit: formatCost(this.budgetConfig.budgetHardStop) },
        "Budget hard stop reached",
      );
    }

    return usage;
  }

  /**
   * Get total session cost.
   */
  getSessionTotal(): number {
    return this.entries.reduce((sum, entry) => sum + entry.usage.costUsd, 0);
  }

  /**
   * Get total token counts.
   */
  getSessionTokens(): { input: number; output: number; total: number } {
    const input = this.entries.reduce((sum, e) => sum + e.usage.inputTokens, 0);
    const output = this.entries.reduce((sum, e) => sum + e.usage.outputTokens, 0);
    return { input, output, total: input + output };
  }

  /**
   * Get cost breakdown by provider, model, and role.
   */
  getBreakdown(): ICostBreakdown {
    const byProvider: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byRole: Record<string, number> = {};

    for (const entry of this.entries) {
      byProvider[entry.provider] = (byProvider[entry.provider] ?? 0) + entry.usage.costUsd;
      byModel[entry.model] = (byModel[entry.model] ?? 0) + entry.usage.costUsd;
      if (entry.role) {
        byRole[entry.role] = (byRole[entry.role] ?? 0) + entry.usage.costUsd;
      }
    }

    return { byProvider, byModel, byRole };
  }

  /**
   * Check if budget hard stop has been exceeded.
   */
  isBudgetExceeded(): boolean {
    return this.getSessionTotal() >= this.budgetConfig.budgetHardStop;
  }

  /**
   * Get formatted session summary.
   */
  getSummary(): string {
    const total = this.getSessionTotal();
    const tokens = this.getSessionTokens();
    return `${formatCost(total)} (${tokens.total.toLocaleString()} tokens)`;
  }

  /**
   * Get all cost entries (for export).
   */
  getEntries(): readonly ICostEntry[] {
    return this.entries;
  }

  /**
   * Reset cost tracking for a new session.
   */
  reset(): void {
    this.entries.length = 0;
    this.warningEmitted = false;
  }
}
