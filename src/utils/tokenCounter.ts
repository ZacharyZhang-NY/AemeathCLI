/**
 * Multi-provider token estimation per PRD section 7.5
 * Uses a universal approximation since we don't bundle tokenizers for each provider.
 */

import type { ProviderName, ITokenUsage, IModelInfo } from "../types/index.js";
import { SUPPORTED_MODELS } from "../types/index.js";

/**
 * Approximate token count using the ~4 chars per token heuristic.
 * For production cost tracking, we rely on provider-reported usage in API responses.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate cost in USD based on token usage and model pricing.
 */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const modelInfo = SUPPORTED_MODELS[modelId];
  if (!modelInfo) {
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * modelInfo.inputPricePerMToken;
  const outputCost = (outputTokens / 1_000_000) * modelInfo.outputPricePerMToken;

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/**
 * Create a token usage record with cost calculation.
 */
export function createTokenUsage(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): ITokenUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateCost(modelId, inputTokens, outputTokens),
  };
}

/**
 * Format cost for display (e.g., "$0.04").
 */
export function formatCost(costUsd: number): string {
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Format token count for display (e.g., "12.3K").
 */
export function formatTokenCount(count: number): string {
  if (count < 1_000) {
    return String(count);
  }
  if (count < 1_000_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return `${(count / 1_000_000).toFixed(1)}M`;
}
