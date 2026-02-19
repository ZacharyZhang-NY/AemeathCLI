/**
 * API Key Fallback — store/retrieve/validate API keys per provider
 * Per PRD section 13.5 — optional fallback for CI/headless environments
 */

import type { ProviderName, ICredential } from "../types/index.js";
import { CredentialStore } from "./credential-store.js";
import { logger } from "../utils/index.js";

// ── Environment Variable Mapping ─────────────────────────────────────────

const ENV_KEY_MAP: Readonly<Record<ProviderName, string | undefined>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  kimi: "MOONSHOT_API_KEY",
  ollama: undefined,
} as const;

// ── CLI-Friendly Provider Names ──────────────────────────────────────────

const CLI_PROVIDER_MAP: Readonly<Record<string, ProviderName>> = {
  claude: "anthropic",
  anthropic: "anthropic",
  openai: "openai",
  codex: "openai",
  google: "google",
  gemini: "google",
  kimi: "kimi",
  moonshot: "kimi",
} as const;

// ── API Key Validation Patterns ──────────────────────────────────────────

const KEY_PATTERNS: Readonly<Record<ProviderName, RegExp | undefined>> = {
  anthropic: /^sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}$/,
  openai: /^sk-[A-Za-z0-9_-]{20,}$/,
  google: /^AIza[A-Za-z0-9_-]{30,}$/,
  kimi: /^sk-[A-Za-z0-9_-]{20,}$/,
  ollama: undefined,
} as const;

const API_KEY_CREDENTIAL_PREFIX = "apikey:";

// ── Public Helpers ───────────────────────────────────────────────────────

export function resolveProviderName(alias: string): ProviderName | undefined {
  const normalized = alias.toLowerCase().trim();
  return CLI_PROVIDER_MAP[normalized];
}

export function getEnvKeyName(provider: ProviderName): string | undefined {
  return ENV_KEY_MAP[provider];
}

// ── ApiKeyFallback Class ─────────────────────────────────────────────────

export class ApiKeyFallback {
  private readonly store: CredentialStore;

  constructor(store?: CredentialStore) {
    this.store = store ?? new CredentialStore();
  }

  /**
   * Validate an API key format for a given provider.
   */
  validateKeyFormat(provider: ProviderName, key: string): boolean {
    const pattern = KEY_PATTERNS[provider];
    if (pattern === undefined) {
      return key.length > 0;
    }
    return pattern.test(key);
  }

  /**
   * Store an API key for a provider via the credential store.
   */
  async setKey(provider: ProviderName, key: string): Promise<void> {
    if (!this.validateKeyFormat(provider, key)) {
      logger.warn({ provider }, "API key format does not match expected pattern — storing anyway");
    }

    const credential: ICredential = {
      provider,
      method: "api_key",
      token: `${API_KEY_CREDENTIAL_PREFIX}${key}`,
    };

    await this.store.set(provider, credential);
    logger.info({ provider }, "API key stored");
  }

  /**
   * Retrieve a stored API key credential for a provider.
   * Only returns credentials stored via setKey (not native login tokens).
   */
  async getCredential(provider: ProviderName): Promise<ICredential | undefined> {
    const stored = await this.store.get(provider);
    if (stored === undefined) return undefined;

    if (stored.method !== "api_key") return undefined;

    // Strip the internal prefix
    if (stored.token?.startsWith(API_KEY_CREDENTIAL_PREFIX)) {
      return {
        ...stored,
        token: stored.token.slice(API_KEY_CREDENTIAL_PREFIX.length),
      };
    }

    return stored;
  }

  /**
   * Get an API key from environment variables.
   */
  getFromEnvironment(provider: ProviderName): ICredential | undefined {
    const envKey = ENV_KEY_MAP[provider];
    if (envKey === undefined) return undefined;

    const value = process.env[envKey];
    if (value === undefined || value.length === 0) return undefined;

    return {
      provider,
      method: "env_variable",
      token: value,
    };
  }

  /**
   * Delete a stored API key for a provider.
   */
  async deleteKey(provider: ProviderName): Promise<void> {
    const stored = await this.store.get(provider);
    if (stored !== undefined && stored.method === "api_key") {
      await this.store.delete(provider);
      logger.info({ provider }, "API key deleted");
    }
  }

  /**
   * Check if an API key is available (stored or env) for a provider.
   */
  async hasKey(provider: ProviderName): Promise<boolean> {
    const stored = await this.getCredential(provider);
    if (stored !== undefined) return true;
    return this.getFromEnvironment(provider) !== undefined;
  }
}
