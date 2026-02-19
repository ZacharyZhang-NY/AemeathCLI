/**
 * Configuration management commands per PRD section 12.3
 */

import { Command } from "commander";
import pc from "picocolors";

export function createConfigCommand(): Command {
  const config = new Command("config")
    .description("Configuration management");

  config
    .command("get [key]")
    .description("Get configuration value (or all if no key)")
    .action(async (key: string | undefined) => {
      try {
        const { ConfigStore } = await import("../../storage/config-store.js");
        const store = new ConfigStore();
        const cfg = await store.loadGlobal();

        if (key) {
          const value = getNestedValue(cfg, key);
          if (value === undefined) {
            process.stderr.write(pc.red(`Configuration key not found: ${key}\n`));
            process.exitCode = 1;
            return;
          }
          process.stdout.write(`${key} = ${JSON.stringify(value, null, 2)}\n`);
        } else {
          process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Failed to read config: ${message}\n`));
        process.exitCode = 3;
      }
    });

  config
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action(async (key: string, value: string) => {
      try {
        const { ConfigStore } = await import("../../storage/config-store.js");
        const store = new ConfigStore();
        const cfg = await store.loadGlobal();

        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          parsedValue = value;
        }

        setNestedValue(cfg as unknown as Record<string, unknown>, key, parsedValue);
        await store.saveGlobal(cfg);
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
    .action(async () => {
      try {
        const { runFirstRunSetup } = await import("../../ui/App.js");
        await runFirstRunSetup();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Setup failed: ${message}\n`));
        process.exitCode = 3;
      }
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
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) continue;
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
