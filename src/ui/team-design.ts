/**
 * LLM-driven dynamic team design — system prompt, parsing, and spec types.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 *
 * Teams are NEVER predefined — every team is dynamically designed by the LLM
 * based on the user's prompt, following the Claude Code agent-team pattern.
 */

import type { ModelRole, ProviderName, IGlobalConfig } from "../types/index.js";
import { SUPPORTED_MODELS } from "../types/index.js";
import type { CliProviderType } from "../orchestrator/constants.js";
import { getCliProviderEntry, getCliProviderForModelProvider } from "../orchestrator/utils/provider-catalog.js";

/**
 * System prompt for the LLM to design an agent team from natural language.
 * The LLM analyzes the user's request and outputs a JSON array of agent specs.
 */
export const TEAM_DESIGN_SYSTEM_PROMPT =
  "You are an expert team architect for an AI-powered CLI coding tool. " +
  "Your job is to analyze a user's request and design an optimal agent team to accomplish it.\n\n" +
  "You MUST respond with ONLY a JSON array (no markdown, no explanation, no code fences). " +
  "Each element represents one agent with these exact fields:\n" +
  '- "name": string — PascalCase name describing the agent\'s function (e.g. "ProjectManager", "TypeScriptDeveloper", "SecurityAuditor")\n' +
  '- "agentType": string — short role type (e.g. "lead", "developer", "reviewer", "researcher", "designer", "architect", "auditor", "tester")\n' +
  '- "model": string — one of the available models (provided in the user message)\n' +
  '- "role": string — one of: "planning", "coding", "review", "testing", "bugfix", "documentation"\n' +
  '- "taskPrompt": string — detailed, specific instructions for this agent. Include: what to focus on, what files/areas to examine, what deliverables are expected, and what tools to use. This must be tailored to the user\'s actual request, NOT generic.\n\n' +
  "Guidelines for team design:\n" +
  "- Use the MINIMUM number of agents needed to accomplish the task (typically 2-5, max 8)\n" +
  "- Assign the most capable models (opus, gpt-5.2, gemini pro) to critical roles like planning and review\n" +
  "- Assign efficient models (sonnet, haiku, flash) to implementation, testing, and documentation\n" +
  "- Every team MUST have at least one agent with role \"coding\" to do actual implementation\n" +
  "- For complex tasks, include a planner/lead agent and a reviewer agent\n" +
  "- If only one provider's models are available, use those models for all agents\n" +
  "- Each agent's taskPrompt must be highly specific to the user's request — never use generic instructions\n" +
  "- Agent names should reflect their specific responsibility in this task\n";

/** Parsed agent specification from the LLM's team design response. */
export interface ILLMAgentSpec {
  readonly name: string;
  readonly agentType: string;
  readonly model: string;
  readonly role: ModelRole;
  readonly taskPrompt: string;
}

const VALID_ROLES: ReadonlySet<string> = new Set([
  "planning", "coding", "review", "testing", "bugfix", "documentation",
]);

/**
 * Parse the LLM's team design response into validated agent specs.
 * Extracts JSON from the response, validates each agent, and falls back
 * to safe defaults for any invalid fields.
 */
export function parseLLMTeamDesign(
  response: string,
  availableModels: readonly string[],
  fallbackModel: string,
): ILLMAgentSpec[] {
  let jsonStr = response.trim();

  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(jsonStr);
  if (fenceMatch?.[1] !== undefined) {
    jsonStr = fenceMatch[1].trim();
  }

  const arrayStart = jsonStr.indexOf("[");
  const arrayEnd = jsonStr.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) {
    throw new Error("LLM response does not contain a valid JSON array for team design");
  }
  jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse LLM team design as JSON");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("LLM team design must be a non-empty array");
  }

  const availableSet = new Set(availableModels);
  const specs: ILLMAgentSpec[] = [];

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;

    const name = typeof record["name"] === "string" && record["name"].length > 0
      ? record["name"]
      : `Agent${specs.length + 1}`;
    const agentType = typeof record["agentType"] === "string" && record["agentType"].length > 0
      ? record["agentType"]
      : "developer";
    const rawModel = typeof record["model"] === "string" ? record["model"] : "";
    const rawRole = typeof record["role"] === "string" ? record["role"] : "coding";
    const taskPrompt = typeof record["taskPrompt"] === "string" ? record["taskPrompt"] : "";

    const model = availableSet.has(rawModel) ? rawModel : fallbackModel;
    const role = VALID_ROLES.has(rawRole) ? (rawRole as ModelRole) : "coding";

    specs.push({ name, agentType, model, role, taskPrompt });
  }

  if (specs.length === 0) {
    throw new Error("LLM team design produced no valid agent specifications");
  }

  return specs.slice(0, 8);
}

/**
 * Build the user prompt sent to the LLM for team design.
 */
export function buildTeamDesignUserPrompt(
  userRequest: string,
  availableModels: readonly string[],
): string {
  const modelList = availableModels.map((id) => {
    const info = SUPPORTED_MODELS[id];
    if (!info) return `- ${id}`;
    return `- ${id} (${info.provider}, ${info.name})`;
  }).join("\n");

  return (
    `Available models:\n${modelList}\n\n` +
    `User request:\n${userRequest}\n\n` +
    "Design the agent team. Respond with ONLY a JSON array."
  );
}

export function resolveMasterProviderPriority(
  swarmConfig: IGlobalConfig["swarm"],
  installedProviders: readonly CliProviderType[],
): readonly CliProviderType[] {
  const configuredProviders = [
    ...(swarmConfig.primaryMasterProvider ? [swarmConfig.primaryMasterProvider] : []),
    ...swarmConfig.fallbackMasterProviders,
  ];
  const prioritized = configuredProviders.filter((provider) => installedProviders.includes(provider));
  const remaining = installedProviders.filter((provider) => !prioritized.includes(provider));
  return [...prioritized, ...remaining];
}

export function getAvailableModelsForProviders(providers: readonly CliProviderType[]): readonly string[] {
  const allowedProviders = new Set(
    providers.map((provider) => getCliProviderEntry(provider).provider),
  );

  return Object.keys(SUPPORTED_MODELS).filter((modelId) => {
    const info = SUPPORTED_MODELS[modelId];
    return info !== undefined && allowedProviders.has(info.provider);
  });
}

export function pickLeadModel(
  config: IGlobalConfig,
  prioritizedProviders: readonly CliProviderType[],
  availableModels: readonly string[],
): string | undefined {
  for (const provider of prioritizedProviders) {
    const providerName = getCliProviderEntry(provider).provider;
    const planningCandidates = [
      config.roles.planning?.primary,
      ...(config.roles.planning?.fallback ?? []),
    ].filter((modelId): modelId is string => modelId !== undefined);

    const preferredPlanningModel = planningCandidates.find((modelId) => {
      const info = SUPPORTED_MODELS[modelId];
      return info?.provider === providerName && availableModels.includes(modelId);
    });
    if (preferredPlanningModel) {
      return preferredPlanningModel;
    }

    const firstAvailableModel = availableModels.find((modelId) => {
      const info = SUPPORTED_MODELS[modelId];
      return info?.provider === providerName;
    });
    if (firstAvailableModel) {
      return firstAvailableModel;
    }
  }

  return availableModels[0];
}

export function normalizeLeadAgentSpec(
  specs: readonly ILLMAgentSpec[],
  masterModel: string,
): readonly ILLMAgentSpec[] {
  const leadSpec = specs.find((spec) => spec.agentType === "lead")
    ?? specs.find((spec) => spec.role === "planning")
    ?? specs[0];

  if (!leadSpec) {
    return specs;
  }

  const normalizedLead: ILLMAgentSpec = {
    ...leadSpec,
    name: leadSpec.name,
    agentType: "lead",
    model: masterModel,
    role: "planning",
    taskPrompt:
      `${leadSpec.taskPrompt}\n\n` +
      "You are the sponsoring master agent. Own planning, delegation, and final synthesis.",
  };

  const workerSpecs = specs.filter((spec) => spec.name !== leadSpec.name);
  return [normalizedLead, ...workerSpecs];
}

/**
 * Build a launcher shell script for an agent pane.
 */
export function writeAgentLauncherScript(
  provider: string,
  model: string,
  promptFile: string,
  launcherFile: string,
  projectRoot: string,
  shellEscapeFn: (s: string) => string,
  writeFileSyncFn: (path: string, data: string, opts?: { mode?: number }) => void,
): string {
  const cliProvider = getCliProviderForModelProvider(provider as ProviderName);

  if (cliProvider) {
    const startCommand = getCliProviderEntry(cliProvider).startCommand(model);
    const script = [
      "#!/bin/bash",
      `cd '${shellEscapeFn(projectRoot)}' || exit 1`,
      `${startCommand} "$(cat '${shellEscapeFn(promptFile)}')"`,
    ].join("\n");
    writeFileSyncFn(launcherFile, script, { mode: 0o755 });
    return `bash '${shellEscapeFn(launcherFile)}'`;
  }

  const script = [
    "#!/bin/bash",
    `cd '${shellEscapeFn(projectRoot)}' || exit 1`,
    `export AEMEATHCLI_PROMPT_FILE='${shellEscapeFn(promptFile)}'`,
    `'${shellEscapeFn(process.execPath)}' '${shellEscapeFn(process.argv[1] ?? "aemeathcli")}' --model ${model}`,
  ].join("\n");
  writeFileSyncFn(launcherFile, script, { mode: 0o755 });
  return `bash '${shellEscapeFn(launcherFile)}'`;
}
