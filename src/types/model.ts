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
    supportedRoles: ["planning", "review", "bugfix"],
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
    supportedRoles: ["coding", "bugfix", "documentation"],
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
  },
  "gpt-5.2-mini": {
    id: "gpt-5.2-mini",
    name: "GPT-5.2 Mini",
    provider: "openai",
    contextWindow: 256_000,
    maxOutputTokens: 16_384,
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["testing", "documentation"],
  },
  o3: {
    id: "o3",
    name: "o3",
    provider: "openai",
    contextWindow: 256_000,
    maxOutputTokens: 100_000,
    inputPricePerMToken: 10,
    outputPricePerMToken: 40,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["planning", "review"],
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
  },
  "kimi-k2.5": {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    provider: "kimi",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    inputPricePerMToken: 0.5,
    outputPricePerMToken: 2,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["coding", "bugfix"],
  },
};

export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";
