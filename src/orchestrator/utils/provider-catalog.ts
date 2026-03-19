import type { ProviderName } from "../../types/model.js";
import type { CliProviderType } from "../constants.js";

export type LoginProvider = "claude" | "codex" | "gemini" | "kimi";

export interface CliProviderCatalogEntry {
  readonly type: CliProviderType;
  readonly provider: ProviderName;
  readonly binary: string;
  readonly label: string;
  readonly description: string;
  readonly loginProvider?: LoginProvider | undefined;
  readonly localOnly: boolean;
  readonly startCommand: (model?: string) => string;
}

export const CLI_PROVIDER_CATALOG: Readonly<Record<CliProviderType, CliProviderCatalogEntry>> = {
  "claude-code": {
    type: "claude-code",
    provider: "anthropic",
    binary: "claude",
    label: "Claude Code",
    description: "Anthropic native CLI agent",
    loginProvider: "claude",
    localOnly: false,
    startCommand: () => "claude --dangerously-skip-permissions",
  },
  codex: {
    type: "codex",
    provider: "openai",
    binary: "codex",
    label: "Codex",
    description: "OpenAI native CLI agent",
    loginProvider: "codex",
    localOnly: false,
    startCommand: () => "codex --full-auto",
  },
  "gemini-cli": {
    type: "gemini-cli",
    provider: "google",
    binary: "gemini",
    label: "Gemini CLI",
    description: "Google native CLI agent",
    loginProvider: "gemini",
    localOnly: false,
    startCommand: () => "gemini",
  },
  "kimi-cli": {
    type: "kimi-cli",
    provider: "kimi",
    binary: "kimi",
    label: "Kimi CLI",
    description: "Moonshot native CLI agent",
    loginProvider: "kimi",
    localOnly: false,
    startCommand: () => "kimi",
  },
  ollama: {
    type: "ollama",
    provider: "ollama",
    binary: "ollama",
    label: "Ollama",
    description: "Local agent runtime",
    localOnly: true,
    startCommand: (model?: string) => `ollama run ${model ?? "llama3"}`,
  },
};

export const CLI_PROVIDER_ORDER: readonly CliProviderType[] = [
  "claude-code",
  "codex",
  "gemini-cli",
  "kimi-cli",
  "ollama",
] as const;

export function getCliProviderEntry(provider: CliProviderType): CliProviderCatalogEntry {
  return CLI_PROVIDER_CATALOG[provider];
}

export function getCliProviderLabel(provider: CliProviderType): string {
  return getCliProviderEntry(provider).label;
}

export function getCliProviderForModelProvider(provider: ProviderName): CliProviderType | undefined {
  return CLI_PROVIDER_ORDER.find(
    (cliProvider) => CLI_PROVIDER_CATALOG[cliProvider].provider === provider,
  );
}
