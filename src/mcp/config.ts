/**
 * MCP configuration loader per PRD section 11.2
 * Load, validate, merge global + project configs, expand env vars, watch for changes.
 */

import { readFileSync, existsSync, watchFile, unwatchFile } from "node:fs";
import { z } from "zod";
import { logger } from "../utils/logger.js";
import { getMCPConfigPath, getProjectMCPConfigPath } from "../utils/pathResolver.js";
import { InvalidConfigError } from "../types/errors.js";
import type { IMCPConfig, IMCPServerConfig } from "../types/config.js";

// ── Zod Validation Schema ───────────────────────────────────────────────

const MCPServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

const MCPConfigSchema = z.object({
  mcpServers: z.record(MCPServerConfigSchema).default({}),
});

// ── Environment Variable Expansion ──────────────────────────────────────

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

function expandEnvVar(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    const resolved = process.env[varName];
    if (resolved === undefined) {
      logger.warn({ variable: varName }, "Environment variable not set, using empty string");
      return "";
    }
    return resolved;
  });
}

function expandServerConfig(server: IMCPServerConfig): IMCPServerConfig {
  const base: { command: string; args: readonly string[] } = {
    command: expandEnvVar(server.command),
    args: server.args.map(expandEnvVar),
  };

  if (server.env === undefined) {
    return base;
  }

  const expandedEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(server.env)) {
    expandedEnv[key] = expandEnvVar(val);
  }

  return { ...base, env: expandedEnv };
}

function expandConfigEnv(config: IMCPConfig): IMCPConfig {
  const expanded: Record<string, IMCPServerConfig> = {};
  for (const [name, server] of Object.entries(config.mcpServers)) {
    expanded[name] = expandServerConfig(server);
  }
  return { mcpServers: expanded };
}

// ── Config Loader ───────────────────────────────────────────────────────

type ConfigChangeCallback = (config: IMCPConfig) => void;

const EMPTY_CONFIG: IMCPConfig = { mcpServers: {} };

export class MCPConfigLoader {
  private currentConfig: IMCPConfig = EMPTY_CONFIG;
  private readonly changeCallbacks: ConfigChangeCallback[] = [];
  private readonly watchedPaths: string[] = [];
  private projectRoot: string | undefined;

  /**
   * Load merged MCP config from global + project paths.
   * Project config overrides global config per server name.
   */
  load(projectRoot?: string): IMCPConfig {
    this.projectRoot = projectRoot;

    const globalConfig = this.loadFromPath(getMCPConfigPath());
    const projectConfig = projectRoot
      ? this.loadFromPath(getProjectMCPConfigPath(projectRoot))
      : EMPTY_CONFIG;

    const merged: IMCPConfig = {
      mcpServers: {
        ...globalConfig.mcpServers,
        ...projectConfig.mcpServers,
      },
    };

    this.currentConfig = expandConfigEnv(merged);

    logger.info(
      { serverCount: Object.keys(this.currentConfig.mcpServers).length },
      "MCP configuration loaded",
    );

    return this.currentConfig;
  }

  /** Return the currently loaded config. */
  getConfig(): IMCPConfig {
    return this.currentConfig;
  }

  /** Register a callback invoked when config files change on disk. */
  onChange(callback: ConfigChangeCallback): void {
    this.changeCallbacks.push(callback);
  }

  /** Start watching config files for changes. */
  watch(): void {
    this.stopWatching();

    const globalPath = getMCPConfigPath();
    if (existsSync(globalPath)) {
      this.watchPath(globalPath);
    }

    if (this.projectRoot) {
      const projectPath = getProjectMCPConfigPath(this.projectRoot);
      if (existsSync(projectPath)) {
        this.watchPath(projectPath);
      }
    }
  }

  /** Stop watching for config changes. */
  stopWatching(): void {
    for (const watched of this.watchedPaths) {
      unwatchFile(watched);
    }
    this.watchedPaths.length = 0;
  }

  /** Release all resources. */
  dispose(): void {
    this.stopWatching();
    this.changeCallbacks.length = 0;
  }

  private loadFromPath(configPath: string): IMCPConfig {
    if (!existsSync(configPath)) {
      logger.debug({ path: configPath }, "MCP config not found, skipping");
      return EMPTY_CONFIG;
    }

    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      const validated = MCPConfigSchema.parse(parsed);

      logger.debug(
        { path: configPath, servers: Object.keys(validated.mcpServers) },
        "Parsed MCP config",
      );

      return validated as IMCPConfig;
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        const issues = error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new InvalidConfigError("mcp", `Validation failed: ${issues}`);
      }
      if (error instanceof SyntaxError) {
        throw new InvalidConfigError(
          "mcp",
          `Invalid JSON in ${configPath}: ${error.message}`,
        );
      }
      throw error;
    }
  }

  private watchPath(filePath: string): void {
    watchFile(filePath, { interval: 2_000 }, () => {
      logger.info({ path: filePath }, "MCP config changed, reloading");
      try {
        const reloaded = this.load(this.projectRoot);
        for (const cb of this.changeCallbacks) {
          cb(reloaded);
        }
      } catch (error: unknown) {
        logger.error({ error, path: filePath }, "Failed to reload MCP config");
      }
    });
    this.watchedPaths.push(filePath);
  }
}
