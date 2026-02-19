/**
 * Role-based model selection per PRD section 7.2
 * Resolution pipeline: user override → role config → fallback chain → system default
 */

import type {
  ModelRole,
  IModelResolution,
  ModelResolutionSource,
  IRoleConfig,
  IGlobalConfig,
  ProviderName,
  IModelInfo,
} from "../types/index.js";
import { SUPPORTED_MODELS, DEFAULT_MODEL_ID, ModelNotFoundError } from "../types/index.js";
import { logger } from "../utils/index.js";
import { getEventBus } from "./event-bus.js";

export interface IModelRouterConfig {
  readonly defaultModel: string;
  readonly roles: Partial<Record<ModelRole, IRoleConfig>>;
  readonly enabledProviders: readonly ProviderName[];
}

export class ModelRouter {
  private readonly config: IModelRouterConfig;
  private userOverride: string | undefined;

  constructor(config: IModelRouterConfig) {
    this.config = config;
  }

  /**
   * Set a temporary user override that takes highest priority.
   */
  setUserOverride(modelId: string | undefined): void {
    if (modelId !== undefined) {
      this.validateModel(modelId);
    }
    this.userOverride = modelId;
  }

  /**
   * Resolve the best model for a given role through the priority pipeline.
   */
  resolve(role?: ModelRole): IModelResolution {
    // 1. User override (explicit flag: --model claude-opus-4-6)
    if (this.userOverride) {
      const info = this.getModelInfo(this.userOverride);
      return {
        modelId: this.userOverride,
        provider: info.provider,
        source: "user_override",
        role,
      };
    }

    // 2. Role config
    if (role) {
      const roleConfig = this.config.roles[role];
      if (roleConfig) {
        // Try primary model
        if (this.isModelAvailable(roleConfig.primary)) {
          const info = this.getModelInfo(roleConfig.primary);
          return {
            modelId: roleConfig.primary,
            provider: info.provider,
            source: "role_config",
            role,
          };
        }

        // 3. Fallback chain
        for (const fallbackModel of roleConfig.fallback) {
          if (this.isModelAvailable(fallbackModel)) {
            const info = this.getModelInfo(fallbackModel);
            logger.info(
              { role, primary: roleConfig.primary, fallback: fallbackModel },
              "Using fallback model for role",
            );
            return {
              modelId: fallbackModel,
              provider: info.provider,
              source: "fallback_chain",
              role,
            };
          }
        }
      }
    }

    // 4. System default
    const defaultModel = this.config.defaultModel;
    if (this.isModelAvailable(defaultModel)) {
      const info = this.getModelInfo(defaultModel);
      return {
        modelId: defaultModel,
        provider: info.provider,
        source: "system_default",
        role,
      };
    }

    // Last resort: find any available model
    const anyAvailable = this.getAvailableModels()[0];
    if (anyAvailable) {
      return {
        modelId: anyAvailable.id,
        provider: anyAvailable.provider,
        source: "system_default",
        role,
      };
    }

    throw new ModelNotFoundError(defaultModel);
  }

  /**
   * Check if a model is available (provider is enabled and model is known).
   */
  isModelAvailable(modelId: string): boolean {
    const info = SUPPORTED_MODELS[modelId];
    if (!info) {
      return false;
    }
    return this.config.enabledProviders.includes(info.provider);
  }

  /**
   * Get model info by ID. Throws if not found.
   */
  getModelInfo(modelId: string): IModelInfo {
    const info = SUPPORTED_MODELS[modelId];
    if (!info) {
      throw new ModelNotFoundError(modelId);
    }
    return info;
  }

  /**
   * Get all available models (from enabled providers).
   */
  getAvailableModels(): readonly IModelInfo[] {
    return Object.values(SUPPORTED_MODELS).filter((model) =>
      this.config.enabledProviders.includes(model.provider),
    );
  }

  /**
   * List models recommended for a specific role.
   */
  getModelsForRole(role: ModelRole): readonly IModelInfo[] {
    return this.getAvailableModels().filter((model) =>
      model.supportedRoles.includes(role),
    );
  }

  /**
   * Validate that a model ID exists. Throws ModelNotFoundError if not.
   */
  private validateModel(modelId: string): void {
    if (!SUPPORTED_MODELS[modelId]) {
      throw new ModelNotFoundError(modelId);
    }
  }
}

/**
 * Create a ModelRouter from the global config.
 */
export function createModelRouter(config: IGlobalConfig): ModelRouter {
  const enabledProviders = Object.entries(config.providers)
    .filter(([, providerConfig]) => providerConfig?.enabled)
    .map(([name]) => name as ProviderName);

  return new ModelRouter({
    defaultModel: config.defaultModel,
    roles: config.roles,
    enabledProviders,
  });
}
