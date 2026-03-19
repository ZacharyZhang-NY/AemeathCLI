/**
 * /config slash command handler.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { ICommandContext } from "./types.js";
import { addSystemMessage } from "./types.js";

export async function handleConfigSlashCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "get") {
    const key = args[1];
    try {
      const { ConfigStore } = await import("../../storage/config-store.js");
      const store = new ConfigStore();
      const cfg = store.loadGlobal();
      if (!key) {
        addSystemMessage(ctx, JSON.stringify(cfg, null, 2));
      } else {
        const value = getNestedConfigValue(cfg, key);
        if (value === undefined) {
          addSystemMessage(ctx, `Key not found: ${key}`);
        } else {
          addSystemMessage(ctx, `${key} = ${JSON.stringify(value, null, 2)}`);
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to read config: ${msg}`);
    }
    return;
  }

  if (subcommand === "set") {
    const key = args[1];
    const value = args.slice(2).join(" ");
    if (!key || !value) {
      addSystemMessage(ctx, "Usage: /config set <key> <value>");
      return;
    }
    try {
      const { ConfigStore } = await import("../../storage/config-store.js");
      const store = new ConfigStore();
      const cfg = store.loadGlobal();
      let parsedValue: unknown;
      try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
      setNestedConfigValue(cfg as unknown as Record<string, unknown>, key, parsedValue);
      store.saveGlobal(cfg);
      addSystemMessage(ctx, `Set ${key} = ${JSON.stringify(parsedValue)}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to set config: ${msg}`);
    }
    return;
  }

  addSystemMessage(ctx, "Usage: /config get [key] | /config set <key> <value>");
}

function getNestedConfigValue(obj: unknown, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedConfigValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) continue;
    if (typeof current[key] !== "object" || current[key] === null) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  if (lastKey) current[lastKey] = value;
}
