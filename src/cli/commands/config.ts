/**
 * Configuration management commands
 */

import { Command } from "commander";
import pc from "picocolors";
import { loadConfig } from "../../config/loader.js";
import { loadGlobalConfigFile, saveGlobalConfig } from "../../config/persist.js";
import { AemeathConfigSchema } from "../../config/schema.js";

export function createConfigCommand(): Command {
  const config = new Command("config").description("Configuration management");

  config
    .command("get [key]")
    .description("Get configuration value (or all if no key)")
    .action((key: string | undefined) => {
      try {
        const cfg = loadConfig(process.cwd());
        if (key) {
          const value = getNestedValue(cfg, key);
          if (value === undefined) {
            process.stderr.write(pc.red(`Configuration key not found: ${key}\n`));
            process.exitCode = 1;
            return;
          }
          process.stdout.write(`${key} = ${JSON.stringify(value, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${JSON.stringify(cfg, null, 2)}\n`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Failed to read config: ${message}\n`));
        process.exitCode = 3;
      }
    });

  config
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      try {
        const cfg = loadGlobalConfigFile();
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          parsedValue = value;
        }

        setNestedValue(cfg as unknown as Record<string, unknown>, key, parsedValue);
        const validated = AemeathConfigSchema.parse(cfg);
        saveGlobalConfig(validated);
        process.stdout.write(pc.green(`Set ${key} = ${JSON.stringify(parsedValue)}\n`));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Failed to set config: ${message}\n`));
        process.exitCode = 3;
      }
    });

  config
    .command("init")
    .description("Initialize configuration with interactive setup")
    .option("--defaults", "Write default configuration without interactive prompts")
    .option("--force", "Overwrite or recreate the global configuration")
    .action(async (options: { defaults?: boolean; force?: boolean }) => {
      try {
        const { runFirstRunSetup } = await import("../setup/first-run.js");
        await runFirstRunSetup({
          ...(options.defaults !== undefined ? { defaults: options.defaults } : {}),
          ...(options.force !== undefined ? { force: options.force } : {}),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Setup failed: ${message}\n`));
        process.exitCode = 3;
      }
    });

  config
    .command("path")
    .description("Show the active global configuration path")
    .action(async () => {
      const { getConfigPath } = await import("../../utils/pathResolver.js");
      process.stdout.write(`${getConfigPath()}\n`);
    });

  return config;
}

function getNestedValue(obj: unknown, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!key) {
      continue;
    }
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  if (lastKey) {
    current[lastKey] = value;
  }
}
