import { join } from "node:path";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { AemeathConfig } from "../config/schema.js";

export function getAuthStoragePath(config: AemeathConfig): string {
  return join(config.configDir, "auth.json");
}

export function createAemeathAuthStorage(config: AemeathConfig): AuthStorage {
  return AuthStorage.create(getAuthStoragePath(config));
}
