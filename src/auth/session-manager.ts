/**
 * Multi-provider session lifecycle per PRD section 13.5
 * Resolution priority: native login (CLI delegation) > API key > env variable > credential helper
 *
 * Credentials are obtained by delegating to official CLI tools:
 *   - Claude Code CLI → macOS Keychain
 *   - Codex CLI → ~/.codex/auth.json
 *   - Gemini CLI → ~/.gemini/oauth_creds.json
 *   - Kimi CLI → ~/.kimi/credentials/kimi-code.json
 */

import type { ProviderName, ICredential, AuthMethod } from "../types/index.js";
import { AuthenticationError } from "../types/index.js";
import { CredentialStore } from "./credential-store.js";
import { ApiKeyFallback } from "./api-key-fallback.js";
import { logger } from "../utils/index.js";

export class SessionManager {
  private readonly credentialStore: CredentialStore;
  private readonly apiKeyFallback: ApiKeyFallback;

  constructor(store?: CredentialStore) {
    this.credentialStore = store ?? new CredentialStore();
    this.apiKeyFallback = new ApiKeyFallback(this.credentialStore);
  }

  /**
   * Get the best available credential for a provider.
   * Follows resolution priority from PRD section 13.5.
   */
  async getActiveCredential(provider: ProviderName): Promise<ICredential> {
    // 1. Native account session (delegated CLI login — stored in our credential store)
    const nativeCredential = await this.credentialStore.get(provider);
    if (nativeCredential && nativeCredential.method === "native_login" && !this.isExpired(nativeCredential)) {
      return nativeCredential;
    }

    // 1b. If expired, try re-reading from the official CLI's cached tokens
    if (nativeCredential && nativeCredential.method === "native_login" && this.isExpired(nativeCredential)) {
      const refreshed = await this.refreshFromCliCache(provider);
      if (refreshed) {
        return refreshed;
      }
    }

    // 1c. Even if no native credential stored, check CLI caches directly
    if (!nativeCredential || nativeCredential.method !== "native_login") {
      const fromCli = await this.refreshFromCliCache(provider);
      if (fromCli) {
        return fromCli;
      }
    }

    // 2. API key set via auth set-key
    const apiKeyCredential = await this.apiKeyFallback.getCredential(provider);
    if (apiKeyCredential) {
      return apiKeyCredential;
    }

    // 3. Environment variable
    const envCredential = this.getFromEnvironment(provider);
    if (envCredential) {
      return envCredential;
    }

    throw new AuthenticationError(provider, `No credentials found for ${provider}`);
  }

  /**
   * Check if a provider has any available credential.
   */
  async isAuthenticated(provider: ProviderName): Promise<boolean> {
    try {
      await this.getActiveCredential(provider);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get status info for a provider.
   */
  async getStatus(provider: ProviderName): Promise<{
    loggedIn: boolean;
    method?: AuthMethod | undefined;
    email?: string | undefined;
    plan?: string | undefined;
  }> {
    try {
      const credential = await this.getActiveCredential(provider);
      return {
        loggedIn: true,
        method: credential.method,
        ...(credential.email !== undefined ? { email: credential.email } : {}),
        ...(credential.plan !== undefined ? { plan: credential.plan } : {}),
      };
    } catch {
      return { loggedIn: false };
    }
  }

  /**
   * Get the API key or token string for a provider.
   */
  async getToken(provider: ProviderName): Promise<string> {
    const credential = await this.getActiveCredential(provider);
    if (!credential.token) {
      throw new AuthenticationError(provider, "Credential has no token");
    }
    return credential.token;
  }

  /**
   * Re-read tokens from the official CLI's cached storage.
   * This is the "refresh" mechanism — instead of doing HTTP refresh ourselves,
   * we re-read from the CLI tool's cache which may have been refreshed by the CLI.
   */
  private async refreshFromCliCache(provider: ProviderName): Promise<ICredential | undefined> {
    try {
      const loginModule = await this.loadLoginModule(provider);
      if (!loginModule) {
        return undefined;
      }

      // Prefer direct cached credential extraction from the provider login module.
      if (typeof loginModule.getCachedCredential === "function") {
        const cached = await loginModule.getCachedCredential();
        if (cached) {
          await this.credentialStore.set(provider, cached);
          if (!this.isExpired(cached) || cached.refreshToken !== undefined) {
            logger.info({ provider }, "Loaded credentials from provider CLI cache");
            return cached;
          }
        }
      }

      const status = await loginModule.getStatus();
      if (!status.loggedIn) {
        return undefined;
      }

      // The login module reads from the CLI's cache, check if we can get a fresh credential
      const isStillLoggedIn = await loginModule.isLoggedIn();
      if (!isStillLoggedIn) {
        return undefined;
      }

      // Re-read by checking the stored credential in our store
      // The login modules update the credential store when they find valid tokens
      const credential = await this.credentialStore.get(provider);
      if (credential && !this.isExpired(credential)) {
        logger.info({ provider }, "Refreshed credentials from CLI cache");
        return credential;
      }

      return undefined;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug({ provider, error: msg }, "Failed to refresh from CLI cache");
      return undefined;
    }
  }

  private async loadLoginModule(provider: ProviderName): Promise<{
    getStatus(): Promise<{ loggedIn: boolean; email?: string | undefined; plan?: string | undefined }>;
    isLoggedIn(): Promise<boolean>;
    getCachedCredential?(): Promise<ICredential | undefined>;
  } | undefined> {
    try {
      switch (provider) {
        case "anthropic": {
          const mod = await import("./providers/claude-login.js");
          return new mod.ClaudeLogin(this.credentialStore);
        }
        case "openai": {
          const mod = await import("./providers/codex-login.js");
          return new mod.CodexLogin(this.credentialStore);
        }
        case "google": {
          const mod = await import("./providers/gemini-login.js");
          return new mod.GeminiLogin(this.credentialStore);
        }
        case "kimi": {
          const mod = await import("./providers/kimi-login.js");
          return new mod.KimiLogin(this.credentialStore);
        }
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  private isExpired(credential: ICredential): boolean {
    if (!credential.expiresAt) {
      return false;
    }
    return new Date() > credential.expiresAt;
  }

  private getFromEnvironment(provider: ProviderName): ICredential | undefined {
    const envMap: Record<ProviderName, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
      kimi: "MOONSHOT_API_KEY",
      ollama: "",
    };

    const envKey = envMap[provider];
    if (!envKey) {
      return undefined;
    }

    const token = process.env[envKey];
    if (!token) {
      return undefined;
    }

    return {
      provider,
      method: "env_variable",
      token,
    };
  }
}
