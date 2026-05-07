import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ensureDirectory,
  findProjectRoot,
  getAemeathHome,
  getConfigPath,
  getProjectConfigPath,
} from "../utils/pathResolver.js";
import { DEFAULT_AEMEATH_CONFIG } from "./defaults.js";
import { AemeathConfigSchema, type AemeathConfig } from "./schema.js";

function readJsonIfExists(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }

  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return parsed;
}

function normalizeLegacyConfig(input: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...input };

  const roles =
    typeof normalized["roles"] === "object" && normalized["roles"] !== null
      ? { ...(normalized["roles"] as Record<string, unknown>) }
      : {};

  const defaultModel = normalized["defaultModel"];
  const codingRole =
    typeof roles["coding"] === "object" && roles["coding"] !== null
      ? { ...(roles["coding"] as Record<string, unknown>) }
      : {};

  if (typeof defaultModel === "string" && typeof codingRole["primary"] !== "string") {
    codingRole["primary"] = defaultModel;
    roles["coding"] = codingRole;
    normalized["roles"] = roles;
  }

  if (typeof normalized["configDir"] !== "string") {
    normalized["configDir"] = getAemeathHome();
  }

  return normalized;
}

function mergeRecords(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
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
      result[key] = mergeRecords(current as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function ensureConfigDirectories(config: AemeathConfig): void {
  ensureDirectory(config.configDir, 0o700);
  ensureDirectory(config.sessionsDir, 0o700);
  ensureDirectory(config.skillsDir);
  ensureDirectory(config.extensionsDir);
  ensureDirectory(join(config.configDir, "sessions"));
  ensureDirectory(dirname(join(config.configDir, "auth.json")), 0o700);
}

export function loadConfig(cwd: string = process.cwd()): AemeathConfig {
  const globalConfig = normalizeLegacyConfig(readJsonIfExists(getConfigPath()));
  const projectRoot = findProjectRoot(cwd);
  const projectConfig = normalizeLegacyConfig(readJsonIfExists(getProjectConfigPath(projectRoot)));

  const merged = mergeRecords(
    DEFAULT_AEMEATH_CONFIG as unknown as Record<string, unknown>,
    mergeRecords(globalConfig, projectConfig),
  );

  const config = AemeathConfigSchema.parse(merged);
  ensureConfigDirectories(config);
  return config;
}
