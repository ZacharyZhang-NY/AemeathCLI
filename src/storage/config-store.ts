/**
 * Configuration store — PRD sections 17.2, 17.3
 * Loads/saves global and project config with Zod validation.
 * Merges project config over global config.
 * Watches for config file changes.
 */

import { readFileSync, writeFileSync, watchFile, unwatchFile } from "node:fs";
import { existsSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { logger } from "../utils/logger.js";
import {
  getConfigPath,
  getProjectConfigPath,
  ensureDirectory,
} from "../utils/pathResolver.js";
import { DEFAULT_CONFIG } from "../types/config.js";
import type { IGlobalConfig } from "../types/config.js";

// ── Zod Schemas ─────────────────────────────────────────────────────────

const ProviderConfigSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().optional(),
});

const PermissionConfigSchema = z.object({
  mode: z.enum(["strict", "standard", "permissive"]),
  allowedPaths: z.array(z.string()),
  blockedCommands: z.array(z.string()),
});

const SplitPanelConfigSchema = z.object({
  enabled: z.boolean(),
  backend: z.enum(["tmux", "iterm2"]),
  defaultLayout: z.enum(["auto", "horizontal", "vertical", "grid"]),
  maxPanes: z.number().int().min(1).max(16),
});

const CostConfigSchema = z.object({
  budgetWarning: z.number().nonnegative(),
  budgetHardStop: z.number().nonnegative(),
  currency: z.string(),
});

const TelemetryConfigSchema = z.object({
  enabled: z.boolean(),
  anonymized: z.boolean(),
});

const RoleConfigSchema = z.object({
  primary: z.string(),
  fallback: z.array(z.string()),
});

const OAuthProviderConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  authorizeUrl: z.string().optional(),
  tokenUrl: z.string().optional(),
  scope: z.string().optional(),
});

const OAuthConfigSchema = z.object({
  anthropic: OAuthProviderConfigSchema.optional(),
  openai: OAuthProviderConfigSchema.optional(),
  google: OAuthProviderConfigSchema.optional(),
  kimi: OAuthProviderConfigSchema.optional(),
});

const GlobalConfigSchema = z.object({
  version: z.string(),
  defaultModel: z.string(),
  roles: z.record(z.string(), RoleConfigSchema).optional(),
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
  permissions: PermissionConfigSchema.optional(),
  splitPanel: SplitPanelConfigSchema.optional(),
  cost: CostConfigSchema.optional(),
  telemetry: TelemetryConfigSchema.optional(),
  oauth: OAuthConfigSchema.optional(),
});

type ConfigChangeCallback = (config: IGlobalConfig) => void;

export class ConfigStore {
  private globalConfig: IGlobalConfig = DEFAULT_CONFIG;
  private projectConfig: Partial<IGlobalConfig> | undefined;
  private mergedConfig: IGlobalConfig = DEFAULT_CONFIG;
  private watchers: Array<{ path: string; active: boolean }> = [];
  private changeCallbacks: ConfigChangeCallback[] = [];

  get config(): IGlobalConfig {
    return this.mergedConfig;
  }

  loadGlobal(configPath?: string): IGlobalConfig {
    const resolvedPath = configPath ?? getConfigPath();

    if (!existsSync(resolvedPath)) {
      logger.info(
        { path: resolvedPath },
        "Global config not found, using defaults",
      );
      this.globalConfig = DEFAULT_CONFIG;
      this.rebuildMergedConfig();
      return this.mergedConfig;
    }

    const raw = readFileSync(resolvedPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const validated = GlobalConfigSchema.safeParse(parsed);

    if (!validated.success) {
      logger.warn(
        { errors: validated.error.issues },
        "Global config validation failed, using defaults",
      );
      this.globalConfig = DEFAULT_CONFIG;
      this.rebuildMergedConfig();
      return this.mergedConfig;
    }

    this.globalConfig = this.applyDefaults(validated.data);
    this.rebuildMergedConfig();

    logger.info({ path: resolvedPath }, "Global config loaded");
    return this.mergedConfig;
  }

  loadProject(projectRoot: string): IGlobalConfig {
    const resolvedPath = getProjectConfigPath(projectRoot);

    if (!existsSync(resolvedPath)) {
      logger.debug(
        { path: resolvedPath },
        "Project config not found, using global only",
      );
      this.projectConfig = undefined;
      this.rebuildMergedConfig();
      return this.mergedConfig;
    }

    const raw = readFileSync(resolvedPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const validated = GlobalConfigSchema.partial().safeParse(parsed);

    if (!validated.success) {
      logger.warn(
        { errors: validated.error.issues },
        "Project config validation failed, ignoring",
      );
      this.projectConfig = undefined;
      this.rebuildMergedConfig();
      return this.mergedConfig;
    }

    this.projectConfig = validated.data as Partial<IGlobalConfig>;
    this.rebuildMergedConfig();

    logger.info({ path: resolvedPath }, "Project config loaded");
    return this.mergedConfig;
  }

  saveGlobal(
    config?: IGlobalConfig,
    configPath?: string,
  ): void {
    const resolvedPath = configPath ?? getConfigPath();
    const configToSave = config ?? this.globalConfig;

    ensureDirectory(dirname(resolvedPath));
    const json = JSON.stringify(configToSave, null, 2);
    writeFileSync(resolvedPath, json, { encoding: "utf-8", mode: 0o600 });

    logger.info({ path: resolvedPath }, "Global config saved");

    if (config) {
      this.globalConfig = config;
      this.rebuildMergedConfig();
    }
  }

  saveProject(
    projectRoot: string,
    config: Partial<IGlobalConfig>,
  ): void {
    const resolvedPath = getProjectConfigPath(projectRoot);

    ensureDirectory(dirname(resolvedPath));
    const json = JSON.stringify(config, null, 2);
    writeFileSync(resolvedPath, json, { encoding: "utf-8", mode: 0o600 });

    this.projectConfig = config;
    this.rebuildMergedConfig();

    logger.info({ path: resolvedPath }, "Project config saved");
  }

  watchGlobal(configPath?: string): void {
    const resolvedPath = configPath ?? getConfigPath();
    this.watchConfigFile(resolvedPath, () => {
      this.loadGlobal(resolvedPath);
    });
  }

  watchProject(projectRoot: string): void {
    const resolvedPath = getProjectConfigPath(projectRoot);
    this.watchConfigFile(resolvedPath, () => {
      this.loadProject(projectRoot);
    });
  }

  onChange(callback: ConfigChangeCallback): void {
    this.changeCallbacks.push(callback);
  }

  stopWatching(): void {
    for (const watcher of this.watchers) {
      if (watcher.active) {
        unwatchFile(watcher.path);
        watcher.active = false;
      }
    }
    this.watchers = [];
  }

  private watchConfigFile(filePath: string, onUpdate: () => void): void {
    if (!existsSync(filePath)) {
      return;
    }

    const entry = { path: filePath, active: true };
    this.watchers.push(entry);

    watchFile(filePath, { interval: 2000 }, () => {
      if (!entry.active) {
        return;
      }
      logger.info({ path: filePath }, "Config file changed, reloading");
      try {
        onUpdate();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, "Failed to reload config");
      }
    });
  }

  private rebuildMergedConfig(): void {
    if (!this.projectConfig) {
      this.mergedConfig = { ...this.globalConfig };
    } else {
      this.mergedConfig = {
        ...this.globalConfig,
        ...this.projectConfig,
        roles: {
          ...this.globalConfig.roles,
          ...(this.projectConfig.roles ?? {}),
        },
        providers: {
          ...this.globalConfig.providers,
          ...(this.projectConfig.providers ?? {}),
        },
        permissions: {
          ...this.globalConfig.permissions,
          ...(this.projectConfig.permissions ?? {}),
        },
        splitPanel: {
          ...this.globalConfig.splitPanel,
          ...(this.projectConfig.splitPanel ?? {}),
        },
        cost: {
          ...this.globalConfig.cost,
          ...(this.projectConfig.cost ?? {}),
        },
        telemetry: {
          ...this.globalConfig.telemetry,
          ...(this.projectConfig.telemetry ?? {}),
        },
        oauth: this.projectConfig.oauth ?? this.globalConfig.oauth,
      };
    }

    for (const cb of this.changeCallbacks) {
      try {
        cb(this.mergedConfig);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, "Config change callback failed");
      }
    }
  }

  private applyDefaults(
    partial: z.infer<typeof GlobalConfigSchema>,
  ): IGlobalConfig {
    return {
      version: partial.version,
      defaultModel: partial.defaultModel,
      roles: {
        ...DEFAULT_CONFIG.roles,
        ...(partial.roles as IGlobalConfig["roles"] | undefined),
      },
      providers: {
        ...DEFAULT_CONFIG.providers,
        ...(partial.providers as IGlobalConfig["providers"] | undefined),
      },
      permissions: partial.permissions
        ? (partial.permissions as IGlobalConfig["permissions"])
        : DEFAULT_CONFIG.permissions,
      splitPanel: partial.splitPanel
        ? (partial.splitPanel as IGlobalConfig["splitPanel"])
        : DEFAULT_CONFIG.splitPanel,
      cost: partial.cost
        ? (partial.cost as IGlobalConfig["cost"])
        : DEFAULT_CONFIG.cost,
      telemetry: partial.telemetry
        ? (partial.telemetry as IGlobalConfig["telemetry"])
        : DEFAULT_CONFIG.telemetry,
      oauth: partial.oauth
        ? (partial.oauth as IGlobalConfig["oauth"])
        : undefined,
    };
  }
}
