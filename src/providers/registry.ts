/**
 * Provider registry per PRD section 7.1
 * Central registry for provider adapters — register, resolve, list.
 */

import { logger } from "../utils/logger.js";
import { ModelNotFoundError } from "../types/errors.js";
import { SUPPORTED_MODELS } from "../types/model.js";
import type { IModelInfo } from "../types/model.js";
import type { IModelProvider } from "./types.js";

/**
 * Singleton registry that maps provider names and model IDs to provider adapters.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, IModelProvider>();
  private readonly modelToProvider = new Map<string, string>();

  /**
   * Register a provider adapter.
   * Automatically indexes all supported models to this provider.
   */
  register(provider: IModelProvider): void {
    this.providers.set(provider.name, provider);

    for (const modelId of provider.supportedModels) {
      this.modelToProvider.set(modelId, provider.name);
    }

    logger.debug(
      { provider: provider.name, models: provider.supportedModels },
      "Provider registered",
    );
  }

  /**
   * Get a provider adapter by its name (e.g. "anthropic", "openai").
   */
  getByName(name: string): IModelProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get the provider adapter that supports a given model ID.
   * @throws ModelNotFoundError if no provider serves this model.
   */
  getForModel(modelId: string): IModelProvider {
    const providerName = this.modelToProvider.get(modelId);
    if (providerName === undefined) {
      throw new ModelNotFoundError(modelId);
    }

    const provider = this.providers.get(providerName);
    if (provider === undefined) {
      throw new ModelNotFoundError(modelId);
    }

    return provider;
  }

  /**
   * Resolve a model string to its provider.
   * Supports both model IDs ("claude-sonnet-4-6") and provider-prefixed
   * forms ("anthropic:claude-sonnet-4-6").
   */
  resolve(modelString: string): { provider: IModelProvider; modelId: string } {
    const colonIndex = modelString.indexOf(":");
    if (colonIndex !== -1) {
      const providerName = modelString.slice(0, colonIndex);
      const modelId = modelString.slice(colonIndex + 1);
      const provider = this.providers.get(providerName);
      if (provider === undefined) {
        throw new ModelNotFoundError(modelString);
      }
      return { provider, modelId };
    }

    const provider = this.getForModel(modelString);
    return { provider, modelId: modelString };
  }

  /**
   * List all registered model IDs across all providers.
   */
  listModels(): readonly IModelInfo[] {
    const models: IModelInfo[] = [];

    for (const provider of this.providers.values()) {
      for (const modelId of provider.supportedModels) {
        const info = SUPPORTED_MODELS[modelId];
        if (info !== undefined) {
          models.push(info);
        }
      }
    }

    return models;
  }

  /**
   * List all registered provider names.
   */
  listProviders(): readonly string[] {
    return [...this.providers.keys()];
  }

  /**
   * Check if a model ID is supported by any registered provider.
   */
  hasModel(modelId: string): boolean {
    return this.modelToProvider.has(modelId);
  }

  /**
   * Check if a provider is registered.
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * List available models from all providers.
   * Uses dynamic API listing where supported, falls back to static models.
   */
  async listAllAvailableModels(): Promise<Map<string, readonly string[]>> {
    const entries = [...this.providers.entries()];
    const fetched = await Promise.all(
      entries.map(async ([name, provider]): Promise<[string, readonly string[]]> => {
        if (typeof provider.listAvailableModels === "function") {
          try {
            return [name, await provider.listAvailableModels()];
          } catch {
            return [name, [...provider.supportedModels]];
          }
        }
        return [name, [...provider.supportedModels]];
      }),
    );

    const result = new Map<string, readonly string[]>();
    fetched.sort(([a], [b]) => a.localeCompare(b));
    for (const [name, models] of fetched) {
      result.set(name, models);
    }

    return result;
  }
}

/**
 * Create a pre-populated registry with all available providers.
 * Resolves credentials via SessionManager (CLI delegation, API keys, env vars).
 */
export async function createDefaultRegistry(): Promise<ProviderRegistry> {
  const registry = new ProviderRegistry();

  const { SessionManager } = await import("../auth/session-manager.js");
  const session = new SessionManager();
  const { execa } = await import("execa");

  const cliAvailability = new Map<string, boolean>();
  const hasCli = async (command: string): Promise<boolean> => {
    const cached = cliAvailability.get(command);
    if (cached !== undefined) {
      return cached;
    }

    try {
      await execa("which", [command], { timeout: 3000 });
      cliAvailability.set(command, true);
      return true;
    } catch {
      cliAvailability.set(command, false);
      return false;
    }
  };

  const providerLoaders: ReadonlyArray<{
    name: string;
    load: () => Promise<IModelProvider>;
  }> = [
    {
      name: "anthropic",
      load: async () => {
        const { ClaudeAdapter } = await import("./claude-adapter.js");
        const credential = await session.getActiveCredential("anthropic").catch(() => undefined);
        const useNative = credential?.method === "native_login"
          || (credential === undefined && await hasCli("claude"));

        if (useNative) {
          const { ClaudeNativeCLIAdapter, logNativeAdapterSelection } = await import(
            "./native-cli-adapters.js"
          );
          logNativeAdapterSelection("anthropic");
          return new ClaudeNativeCLIAdapter();
        }

        return new ClaudeAdapter(
          credential?.token !== undefined ? { apiKey: credential.token } : undefined,
        );
      },
    },
    {
      name: "openai",
      load: async () => {
        const { OpenAIAdapter } = await import("./openai-adapter.js");
        const credential = await session.getActiveCredential("openai").catch(() => undefined);
        const useNative = credential?.method === "native_login"
          || (credential === undefined && await hasCli("codex"));

        if (useNative) {
          const { CodexNativeCLIAdapter, logNativeAdapterSelection } = await import(
            "./native-cli-adapters.js"
          );
          logNativeAdapterSelection("openai");
          return new CodexNativeCLIAdapter();
        }

        return new OpenAIAdapter(
          credential?.token !== undefined ? { apiKey: credential.token } : undefined,
        );
      },
    },
    {
      name: "google",
      load: async () => {
        const { GeminiAdapter } = await import("./gemini-adapter.js");
        const credential = await session.getActiveCredential("google").catch(() => undefined);
        const useNative = credential?.method === "native_login"
          || (credential === undefined && await hasCli("gemini"));

        if (useNative) {
          const { GeminiNativeCLIAdapter, logNativeAdapterSelection } = await import(
            "./native-cli-adapters.js"
          );
          logNativeAdapterSelection("google");
          return new GeminiNativeCLIAdapter();
        }

        return new GeminiAdapter(
          credential?.token !== undefined ? { apiKey: credential.token } : undefined,
        );
      },
    },
    {
      name: "kimi",
      load: async () => {
        const { KimiAdapter } = await import("./kimi-adapter.js");
        const credential = await session.getActiveCredential("kimi").catch(() => undefined);
        const useNative = credential?.method === "native_login"
          || (credential === undefined && await hasCli("kimi"));

        if (useNative) {
          const { KimiNativeCLIAdapter, logNativeAdapterSelection } = await import(
            "./native-cli-adapters.js"
          );
          logNativeAdapterSelection("kimi");
          return new KimiNativeCLIAdapter();
        }

        return new KimiAdapter(
          credential?.token !== undefined ? { apiKey: credential.token } : undefined,
        );
      },
    },
  ];

  // Initialize all providers in parallel (including Ollama)
  const ollamaTask = (async () => {
    try {
      const { OllamaAdapter } = await import("./ollama-adapter.js");
      const ollama = new OllamaAdapter();
      await ollama.refreshModels();
      registry.register(ollama);
    } catch {
      // Ollama not available
    }
  })();

  await Promise.all([
    ...providerLoaders.map(async (config) => {
      try {
        const adapter = await config.load();
        registry.register(adapter);
      } catch {
        // Skip provider if adapter fails to initialize
      }
    }),
    ollamaTask,
  ]);

  return registry;
}
