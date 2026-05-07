import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureDirectory, getConfigPath, getProjectConfigPath } from "../utils/pathResolver.js";
import { DEFAULT_AEMEATH_CONFIG } from "./defaults.js";
import { AemeathConfigSchema, type AemeathConfig } from "./schema.js";

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }

  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function mergeObjects(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (
      typeof current === "object" &&
      current !== null &&
      !Array.isArray(current) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = mergeObjects(current as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function saveJson(path: string, value: Record<string, unknown>): void {
  ensureDirectory(dirname(path), 0o700);
  writeFileSync(path, JSON.stringify(value, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function loadGlobalConfigFile(): AemeathConfig {
  const merged = mergeObjects(
    DEFAULT_AEMEATH_CONFIG as unknown as Record<string, unknown>,
    readJson(getConfigPath()),
  );
  return AemeathConfigSchema.parse(merged);
}

export function saveGlobalConfig(config: AemeathConfig): void {
  const validated = AemeathConfigSchema.parse(config);
  saveJson(getConfigPath(), validated as unknown as Record<string, unknown>);
}

export function loadProjectConfigFile(projectRoot: string): Record<string, unknown> {
  return readJson(getProjectConfigPath(projectRoot));
}

export function saveProjectConfig(projectRoot: string, config: Record<string, unknown>): void {
  saveJson(getProjectConfigPath(projectRoot), config);
}
