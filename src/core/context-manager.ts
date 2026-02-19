/**
 * Context window management per PRD section 7.4
 * - Token budgeting: 85% conversation, 15% buffer
 * - Smart truncation: prioritize recent + system prompt
 * - Compression: summarize old messages when approaching limits
 * - File context tracking with LRU eviction
 */

import type { IChatMessage, IModelInfo } from "../types/index.js";
import { estimateTokenCount } from "../utils/index.js";
import { logger } from "../utils/index.js";

const CONTEXT_BUDGET_RATIO = 0.85;
const SYSTEM_PROMPT_RESERVE = 4_000;

interface IFileContextEntry {
  readonly filePath: string;
  readonly tokenCount: number;
  lastAccessedAt: number;
}

export class ContextManager {
  private readonly maxTokens: number;
  private readonly budgetTokens: number;
  private readonly fileContext = new Map<string, IFileContextEntry>();
  private currentTokenCount = 0;

  constructor(modelInfo: IModelInfo) {
    this.maxTokens = modelInfo.contextWindow;
    this.budgetTokens = Math.floor(this.maxTokens * CONTEXT_BUDGET_RATIO);
  }

  /**
   * Get the available token budget for new content.
   */
  getAvailableBudget(): number {
    return Math.max(0, this.budgetTokens - this.currentTokenCount - SYSTEM_PROMPT_RESERVE);
  }

  /**
   * Get total context usage.
   */
  getUsage(): { used: number; budget: number; max: number; percentage: number } {
    return {
      used: this.currentTokenCount,
      budget: this.budgetTokens,
      max: this.maxTokens,
      percentage: Math.round((this.currentTokenCount / this.budgetTokens) * 100),
    };
  }

  /**
   * Trim messages to fit within the context window.
   * Preserves system prompt and most recent messages.
   */
  trimMessages(messages: readonly IChatMessage[], systemPrompt?: string): IChatMessage[] {
    const systemTokens = systemPrompt ? estimateTokenCount(systemPrompt) : 0;
    const availableTokens = this.budgetTokens - systemTokens - SYSTEM_PROMPT_RESERVE;

    if (availableTokens <= 0) {
      logger.warn("System prompt alone exceeds context budget");
      return [];
    }

    // Work backwards from most recent, accumulating tokens
    const result: IChatMessage[] = [];
    let usedTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) {
        continue;
      }
      const msgTokens = estimateTokenCount(msg.content);

      if (usedTokens + msgTokens > availableTokens) {
        break;
      }

      result.unshift(msg);
      usedTokens += msgTokens;
    }

    this.currentTokenCount = usedTokens + systemTokens;

    if (result.length < messages.length) {
      logger.info(
        {
          original: messages.length,
          trimmed: result.length,
          droppedMessages: messages.length - result.length,
        },
        "Trimmed conversation to fit context window",
      );
    }

    return result;
  }

  /**
   * Track a file being added to context.
   */
  addFileContext(filePath: string, content: string): void {
    const tokenCount = estimateTokenCount(content);
    this.fileContext.set(filePath, {
      filePath,
      tokenCount,
      lastAccessedAt: Date.now(),
    });
    this.currentTokenCount += tokenCount;
  }

  /**
   * Touch a file (update last accessed time).
   */
  touchFile(filePath: string): void {
    const entry = this.fileContext.get(filePath);
    if (entry) {
      entry.lastAccessedAt = Date.now();
    }
  }

  /**
   * Remove a file from context.
   */
  removeFileContext(filePath: string): void {
    const entry = this.fileContext.get(filePath);
    if (entry) {
      this.currentTokenCount -= entry.tokenCount;
      this.fileContext.delete(filePath);
    }
  }

  /**
   * Evict least-recently-used files to free space.
   */
  evictLRU(tokensNeeded: number): string[] {
    const evicted: string[] = [];
    const sorted = [...this.fileContext.entries()].sort(
      ([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt,
    );

    let freedTokens = 0;
    for (const [filePath, entry] of sorted) {
      if (freedTokens >= tokensNeeded) {
        break;
      }
      this.removeFileContext(filePath);
      freedTokens += entry.tokenCount;
      evicted.push(filePath);
    }

    if (evicted.length > 0) {
      logger.info(
        { evicted, freedTokens },
        "Evicted files from context to free space",
      );
    }

    return evicted;
  }

  /**
   * Get all tracked files.
   */
  getTrackedFiles(): readonly IFileContextEntry[] {
    return [...this.fileContext.values()];
  }

  /**
   * Reset context tracking (for model switch).
   */
  reset(): void {
    this.fileContext.clear();
    this.currentTokenCount = 0;
  }
}
