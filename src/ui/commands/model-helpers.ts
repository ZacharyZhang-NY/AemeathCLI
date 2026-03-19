/**
 * Model selection helpers for slash commands.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import { SUPPORTED_MODELS, PROVIDER_MODEL_ORDER } from "../../types/index.js";

/**
 * Resolve a model selection input — either a model ID or a global index number
 * from the /model display list.
 */
export function resolveModelSelection(input: string): string | undefined {
  // Direct model ID match
  if (SUPPORTED_MODELS[input]) {
    return input;
  }

  // Numeric index into the global ordered list
  if (/^\d+$/.test(input)) {
    const index = Number(input);
    let globalIndex = 1;
    for (const entries of Object.values(PROVIDER_MODEL_ORDER)) {
      for (const entry of entries) {
        if (globalIndex === index) {
          return entry.id;
        }
        globalIndex++;
      }
    }
  }

  return undefined;
}

/**
 * Human-readable label for a provider's thinking method.
 */
export function formatThinkingMethod(method: string): string {
  switch (method) {
    case "extended_thinking":
      return "Extended Thinking";
    case "reasoning_effort":
      return "Reasoning Effort";
    case "thinking_budget":
      return "Thinking Budget";
    case "thinking_level":
      return "Thinking Level";
    case "thinking_mode":
      return "Thinking Mode";
    default:
      return "Thinking";
  }
}
