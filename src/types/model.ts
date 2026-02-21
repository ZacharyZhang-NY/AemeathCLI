/**
 * Model-related types per PRD sections 7.1-7.5
 */

// ── Provider Identifiers ─────────────────────────────────────────────────

export type ProviderName = "anthropic" | "openai" | "google" | "kimi" | "ollama";

// ── Model Roles (PRD section 7.2) ───────────────────────────────────────

export type ModelRole =
  | "planning"
  | "coding"
  | "review"
  | "testing"
  | "bugfix"
  | "documentation";

// ── Provider-specific Thinking / Reasoning Configuration ─────────────────

export interface IThinkingOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export interface IProviderThinkingConfig {
  readonly method: string;
  readonly options: readonly IThinkingOption[];
  readonly defaultValue: string;
}

/**
 * Provider-specific thinking configurations.
 *
 * Anthropic  → Extended Thinking (budget_tokens: 1024–model max)
 * OpenAI     → Reasoning Effort  (low | medium | high)
 * Google 2.5 → Thinking Budget   (0–24576, -1 = dynamic)
 * Google 3   → Thinking Level    (minimal | low | medium | high)
 * Kimi       → Thinking Mode     (enabled | disabled)
 */
export const PROVIDER_THINKING_CONFIGS: Readonly<Record<string, IProviderThinkingConfig>> = {
  anthropic: {
    method: "extended_thinking",
    options: [
      { value: "off", label: "Off", description: "No extended thinking" },
      { value: "low", label: "Low (1K tokens)", description: "budget_tokens: 1024" },
      { value: "medium", label: "Medium (8K tokens)", description: "budget_tokens: 8192" },
      { value: "high", label: "High (16K tokens)", description: "budget_tokens: 16384" },
      { value: "max", label: "Max (model limit)", description: "budget_tokens: max_output_tokens" },
    ],
    defaultValue: "medium",
  },
  openai: {
    method: "reasoning_effort",
    options: [
      { value: "low", label: "Low", description: "Fewer reasoning tokens, faster" },
      { value: "medium", label: "Medium", description: "Balanced reasoning (default)" },
      { value: "high", label: "High", description: "Thorough reasoning, more tokens" },
    ],
    defaultValue: "medium",
  },
  "google:gemini-2.5": {
    method: "thinking_budget",
    options: [
      { value: "off", label: "Off", description: "Disable thinking (budget: 0)" },
      { value: "dynamic", label: "Dynamic", description: "Auto-adjust based on complexity (budget: -1)" },
      { value: "low", label: "Low (4K tokens)", description: "thinkingBudget: 4096" },
      { value: "medium", label: "Medium (12K tokens)", description: "thinkingBudget: 12288" },
      { value: "high", label: "High (24K tokens)", description: "thinkingBudget: 24576" },
    ],
    defaultValue: "dynamic",
  },
  "google:gemini-3": {
    method: "thinking_level",
    options: [
      { value: "minimal", label: "Minimal", description: "Minimal thinking" },
      { value: "low", label: "Low", description: "Light thinking" },
      { value: "medium", label: "Medium", description: "Balanced thinking" },
      { value: "high", label: "High", description: "Deep thinking" },
    ],
    defaultValue: "medium",
  },
  kimi: {
    method: "thinking_mode",
    options: [
      { value: "enabled", label: "Enabled", description: "Include reasoning traces" },
      { value: "disabled", label: "Disabled", description: "Direct responses only" },
    ],
    defaultValue: "enabled",
  },
};

/**
 * Look up the thinking configuration for a specific model.
 * Handles Google's model-family split (Gemini 2.5 vs Gemini 3).
 */
export function getThinkingConfigForModel(modelId: string): IProviderThinkingConfig | undefined {
  const modelInfo = SUPPORTED_MODELS[modelId];
  if (modelInfo === undefined) return undefined;

  if (modelInfo.provider === "google") {
    if (modelId.startsWith("gemini-3")) {
      return PROVIDER_THINKING_CONFIGS["google:gemini-3"];
    }
    return PROVIDER_THINKING_CONFIGS["google:gemini-2.5"];
  }

  return PROVIDER_THINKING_CONFIGS[modelInfo.provider];
}

// ── Model Information ────────────────────────────────────────────────────

export interface IModelInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: ProviderName;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly inputPricePerMToken: number;
  readonly outputPricePerMToken: number;
  readonly supportsStreaming: boolean;
  readonly supportsToolCalling: boolean;
  readonly supportedRoles: readonly ModelRole[];
  readonly description?: string | undefined;
}

// ── Model Display Entry (for /model selection UI) ────────────────────────

export interface IModelDisplayEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly isDefault?: boolean | undefined;
}

// ── Role Configuration (PRD section 7.2) ─────────────────────────────────

export interface IRoleConfig {
  readonly primary: string;
  readonly fallback: readonly string[];
}

// ── Model Router Resolution (PRD section 7.2) ────────────────────────────

export type ModelResolutionSource =
  | "user_override"
  | "role_config"
  | "fallback_chain"
  | "system_default";

export interface IModelResolution {
  readonly modelId: string;
  readonly provider: ProviderName;
  readonly source: ModelResolutionSource;
  readonly role?: ModelRole | undefined;
}

// ── Token Usage ──────────────────────────────────────────────────────────

export interface ITokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

// ── Supported Models Registry (PRD section 7.3) ─────────────────────────

export const SUPPORTED_MODELS: Record<string, IModelInfo> = {
  // ── Anthropic / Claude ─────────────────────────────────────────────────
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    inputPricePerMToken: 15,
    outputPricePerMToken: 75,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["planning", "review", "bugfix", "coding"],
    description: "Most capable for complex work",
  },
  "claude-opus-4-6-1m": {
    id: "claude-opus-4-6-1m",
    name: "Claude Opus 4.6 (1M context)",
    provider: "anthropic",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
    inputPricePerMToken: 10,
    outputPricePerMToken: 37.5,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["planning", "review", "bugfix", "coding"],
    description: "Opus 4.6 with 1M context",
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["coding", "bugfix", "documentation", "review"],
    description: "Best for everyday tasks",
  },
  "claude-sonnet-4-6-1m": {
    id: "claude-sonnet-4-6-1m",
    name: "Claude Sonnet 4.6 (1M context)",
    provider: "anthropic",
    contextWindow: 1_000_000,
    maxOutputTokens: 16_000,
    inputPricePerMToken: 6,
    outputPricePerMToken: 22.5,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["coding", "bugfix", "documentation", "review"],
    description: "Sonnet 4.6 with 1M context",
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    inputPricePerMToken: 0.8,
    outputPricePerMToken: 4,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["testing", "documentation"],
    description: "Fastest for quick answers",
  },

  // ── OpenAI / Codex ─────────────────────────────────────────────────────
  "gpt-5.3-codex": {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    provider: "openai",
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 10,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["planning", "coding", "review", "bugfix"],
    description: "Latest frontier agentic coding model",
  },
  "gpt-5.3-codex-spark": {
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    provider: "openai",
    contextWindow: 256_000,
    maxOutputTokens: 16_384,
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["coding", "testing", "documentation"],
    description: "Ultra-fast coding model",
  },
  "gpt-5.2-codex": {
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    provider: "openai",
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 10,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["planning", "coding", "review", "bugfix"],
    description: "Frontier agentic coding model",
  },
  "gpt-5.1-codex-max": {
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    provider: "openai",
    contextWindow: 256_000,
    maxOutputTokens: 100_000,
    inputPricePerMToken: 10,
    outputPricePerMToken: 40,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["planning", "review", "coding"],
    description: "Codex-optimized flagship for deep and fast reasoning",
  },
  "gpt-5.2": {
    id: "gpt-5.2",
    name: "GPT-5.2",
    provider: "openai",
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 10,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["planning", "coding", "review", "bugfix"],
    description: "Latest frontier model with improvements across knowledge, reasoning and coding",
  },
  "gpt-5.1-codex-mini": {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex Mini",
    provider: "openai",
    contextWindow: 256_000,
    maxOutputTokens: 16_384,
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["testing", "documentation", "coding"],
    description: "Optimized for codex. Cheaper, faster, but less capable",
  },

  // ── Google / Gemini ────────────────────────────────────────────────────
  "gemini-3-pro-preview": {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro Preview",
    provider: "google",
    contextWindow: 2_000_000,
    maxOutputTokens: 65_536,
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["planning", "review", "coding"],
    description: "Next-gen Gemini Pro preview",
  },
  "gemini-3-flash-preview": {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    provider: "google",
    contextWindow: 2_000_000,
    maxOutputTokens: 65_536,
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["coding", "testing", "documentation"],
    description: "Next-gen Gemini Flash preview",
  },
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    contextWindow: 2_000_000,
    maxOutputTokens: 65_536,
    inputPricePerMToken: 1.25,
    outputPricePerMToken: 10,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["planning", "review", "coding"],
    description: "Gemini 2.5 Pro stable",
  },
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    contextWindow: 2_000_000,
    maxOutputTokens: 65_536,
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["testing", "documentation", "coding"],
    description: "Gemini 2.5 Flash stable",
  },
  "gemini-2.5-flash-lite": {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    provider: "google",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    inputPricePerMToken: 0.075,
    outputPricePerMToken: 0.3,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["testing", "documentation"],
    description: "Gemini 2.5 Flash Lite",
  },

  // ── Moonshot / Kimi ────────────────────────────────────────────────────
  "kimi-for-coding": {
    id: "kimi-for-coding",
    name: "Kimi Code",
    provider: "kimi",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 2,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["coding", "bugfix"],
    description: "Kimi for coding",
  },
};

// ── Ordered Model Lists Per Provider (for /model selection UI) ───────────

export const PROVIDER_MODEL_ORDER: Readonly<Record<string, readonly IModelDisplayEntry[]>> = {
  anthropic: [
    { id: "claude-opus-4-6", label: "Default (recommended)", description: "Opus 4.6 · Most capable for complex work", isDefault: true },
    { id: "claude-opus-4-6-1m", label: "Opus (1M context)", description: "Opus 4.6 with 1M context · Billed as extra usage · $10/$37.50 per Mtok" },
    { id: "claude-sonnet-4-6", label: "Sonnet", description: "Sonnet 4.6 · Best for everyday tasks" },
    { id: "claude-sonnet-4-6-1m", label: "Sonnet (1M context)", description: "Sonnet 4.6 with 1M context · Billed as extra usage · $6/$22.50 per Mtok" },
    { id: "claude-haiku-4-5", label: "Haiku", description: "Haiku 4.5 · Fastest for quick answers" },
  ],
  openai: [
    { id: "gpt-5.3-codex", label: "gpt-5.3-codex", description: "Latest frontier agentic coding model", isDefault: true },
    { id: "gpt-5.3-codex-spark", label: "gpt-5.3-codex-spark", description: "Ultra-fast coding model" },
    { id: "gpt-5.2-codex", label: "gpt-5.2-codex", description: "Frontier agentic coding model" },
    { id: "gpt-5.1-codex-max", label: "gpt-5.1-codex-max", description: "Codex-optimized flagship for deep and fast reasoning" },
    { id: "gpt-5.2", label: "gpt-5.2", description: "Latest frontier model with improvements across knowledge, reasoning and coding" },
    { id: "gpt-5.1-codex-mini", label: "gpt-5.1-codex-mini", description: "Optimized for codex. Cheaper, faster, but less capable" },
  ],
  google: [
    { id: "gemini-3-pro-preview", label: "gemini-3-pro-preview", description: "Next-gen Gemini Pro preview", isDefault: true },
    { id: "gemini-3-flash-preview", label: "gemini-3-flash-preview", description: "Next-gen Gemini Flash preview" },
    { id: "gemini-2.5-pro", label: "gemini-2.5-pro", description: "Gemini 2.5 Pro stable" },
    { id: "gemini-2.5-flash", label: "gemini-2.5-flash", description: "Gemini 2.5 Flash stable" },
    { id: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite", description: "Gemini 2.5 Flash Lite" },
  ],
  kimi: [
    { id: "kimi-for-coding", label: "kimi-for-coding (Kimi Code)", description: "Kimi for coding", isDefault: true },
  ],
};

export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";
