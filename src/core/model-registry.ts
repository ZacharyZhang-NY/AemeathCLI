import { join } from "node:path";
import { ModelRegistry, type AuthStorage } from "@mariozechner/pi-coding-agent";
import type { AemeathConfig } from "../config/schema.js";
import { createAemeathAuthStorage } from "./auth.js";

export function getModelsRegistryPath(config: AemeathConfig): string {
  return join(config.configDir, "models.json");
}

export function createAemeathModelRegistry(
  config: AemeathConfig,
  authStorage: AuthStorage = createAemeathAuthStorage(config),
): ModelRegistry {
  const registry = ModelRegistry.create(authStorage, getModelsRegistryPath(config));

  for (const [providerName, providerConfig] of Object.entries(config.customProviders)) {
    registry.registerProvider(providerName, providerConfig as never);
  }

  return registry;
}
