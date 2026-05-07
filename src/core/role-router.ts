import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AemeathConfig, ModelRole, RoleConfig } from "../config/schema.js";

function normalizeReference(reference: string): { provider: string | undefined; modelId: string } {
  const trimmed = reference.trim();
  if (trimmed.includes("/")) {
    const [provider, ...rest] = trimmed.split("/");
    return { provider, modelId: rest.join("/") };
  }
  if (trimmed.includes(":")) {
    const [provider, ...rest] = trimmed.split(":");
    return { provider, modelId: rest.join(":") };
  }
  return { provider: undefined, modelId: trimmed };
}

export class RoleRouter {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly config: AemeathConfig,
  ) {}

  private resolveFromReference(reference: string): Model<Api> | undefined {
    const { provider, modelId } = normalizeReference(reference);
    if (provider) {
      return this.registry.find(provider, modelId);
    }

    const available = this.registry.getAvailable();
    return available.find((model) => model.id === modelId);
  }

  private getRoleConfig(role: ModelRole): RoleConfig {
    return this.config.roles[role];
  }

  resolve(role: ModelRole, userOverride?: string): Model<Api> | undefined {
    const candidates: string[] = [];
    if (typeof userOverride === "string" && userOverride.trim().length > 0) {
      candidates.push(userOverride);
    }

    const roleConfig = this.getRoleConfig(role);
    candidates.push(roleConfig.primary, ...roleConfig.fallback);

    for (const candidate of candidates) {
      const resolved = this.resolveFromReference(candidate);
      if (resolved) {
        return resolved;
      }
    }

    const available = this.registry.getAvailable();
    if (available.length > 0) {
      return available[0];
    }

    const all = this.registry.getAll();
    return all[0];
  }
}
