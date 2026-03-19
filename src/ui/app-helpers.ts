/**
 * Pure helper functions for the App component.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { IGlobalConfig, IModelResolution } from "../types/index.js";
import type { CliProviderType } from "../orchestrator/constants.js";

export const DEFAULT_SYSTEM_PROMPT =
  "You are AemeathCLI (aemeathcli), a multi-model AI agent orchestrator. " +
  "You help users with coding tasks, code review, debugging, refactoring, and project management. " +
  "You are NOT Claude Code, Codex, or Gemini CLI — you are Aemeath Agent Swarm, an independent tool " +
  "that orchestrates multiple AI providers (Anthropic, OpenAI, Google, Kimi, Ollama).\n\n" +
  "Answer concisely and directly. Key features:\n" +
  "- Multi-model: /model to switch between Claude, GPT, Gemini, Kimi, Ollama\n" +
  "- Agent orchestration: use Shift+Tab to switch into swarm mode inside the TUI\n" +
  "  - swarm mode designs and coordinates multi-agent teams from natural language\n" +
  "  - the master agent owns the left pane, worker agents stream on the right\n" +
  "  - follow the configured master-agent provider preference when building teams\n" +
  "- Skills: $review, $commit, $plan, $debug, $test, $refactor\n" +
  "- Commands: /help, /model, /role, /history, /resume, /cost\n\n" +
  "When users ask about agent swarm, multi-agent, team mode, or orchestration, " +
  "keep them in the current TUI session and tell them to switch modes with Shift+Tab. " +
  "Do not redirect them to a separate `launch` command.";

export function getCandidateModels(
  config: IGlobalConfig,
  resolution: IModelResolution,
  activeModelId: string,
): readonly string[] {
  const candidates: string[] = [activeModelId];

  if (resolution.source !== "user_override" && resolution.role) {
    const roleConfig = config.roles[resolution.role];
    if (roleConfig) {
      candidates.push(roleConfig.primary, ...roleConfig.fallback);
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const modelId of candidates) {
    if (!seen.has(modelId)) {
      seen.add(modelId);
      unique.push(modelId);
    }
  }

  return unique;
}

export function cliProviderListsEqual(
  left: readonly CliProviderType[],
  right: readonly CliProviderType[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function normalizeSwarmConfig(
  swarm: IGlobalConfig["swarm"],
  detectedProviders: readonly CliProviderType[],
): IGlobalConfig["swarm"] {
  const primaryMasterProvider = swarm.primaryMasterProvider !== undefined &&
    detectedProviders.includes(swarm.primaryMasterProvider)
    ? swarm.primaryMasterProvider
    : undefined;
  const fallbackMasterProviders = swarm.fallbackMasterProviders.filter(
    (provider) => provider !== primaryMasterProvider && detectedProviders.includes(provider),
  );

  return {
    onboardingComplete: swarm.onboardingComplete && primaryMasterProvider !== undefined,
    detectedProviders: [...detectedProviders],
    primaryMasterProvider,
    fallbackMasterProviders,
  };
}

export function swarmConfigsEqual(
  left: IGlobalConfig["swarm"],
  right: IGlobalConfig["swarm"],
): boolean {
  return (
    left.onboardingComplete === right.onboardingComplete &&
    left.primaryMasterProvider === right.primaryMasterProvider &&
    cliProviderListsEqual(left.detectedProviders, right.detectedProviders) &&
    cliProviderListsEqual(left.fallbackMasterProviders, right.fallbackMasterProviders)
  );
}
