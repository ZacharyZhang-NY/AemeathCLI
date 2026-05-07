import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AemeathConfig } from "../config/schema.js";

export function aemeathExtension(config: AemeathConfig) {
  return function registerAemeathExtension(pi: ExtensionAPI): void {
    for (const [providerName, providerConfig] of Object.entries(config.customProviders)) {
      pi.registerProvider(providerName, providerConfig as never);
    }
  };
}
