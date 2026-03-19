/**
 * /login slash command handler and login module loader.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { ICommandContext } from "./types.js";
import { addSystemMessage } from "./types.js";

export async function handleLoginSlashCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "status") {
    try {
      const { getAuthStatusRecords, formatCompactAuthStatusLine } = await import("../../auth/auth-status.js");
      const records = await getAuthStatusRecords();
      const lines = records.map((record) => formatCompactAuthStatusLine(record));
      addSystemMessage(ctx, lines.join("\n"));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to get auth status: ${msg}`);
    }
    return;
  }

  if (subcommand === "logout") {
    const provider = args[1];
    if (!provider) {
      addSystemMessage(ctx, "Usage: /login logout <provider>\nProviders: claude, codex, gemini, kimi");
      return;
    }
    try {
      const loginMod = await loadLoginModuleForSlash(provider as "claude" | "codex" | "gemini" | "kimi");
      await loginMod.logout();
      addSystemMessage(ctx, `Logged out of ${provider}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Logout failed: ${msg}`);
    }
    return;
  }

  // No subcommand → open interactive provider selector
  ctx.setSelectionMode({ type: "login" });
}

interface ISlashLoginModule {
  login(): Promise<unknown>;
  logout(): Promise<void>;
  getStatus(): Promise<{ loggedIn: boolean; email?: string | undefined; plan?: string | undefined }>;
}

export async function loadLoginModuleForSlash(provider: string): Promise<ISlashLoginModule> {
  switch (provider) {
    case "claude": {
      const mod = await import("../../auth/providers/claude-login.js");
      return new mod.ClaudeLogin();
    }
    case "codex": {
      const mod = await import("../../auth/providers/codex-login.js");
      return new mod.CodexLogin();
    }
    case "gemini": {
      const mod = await import("../../auth/providers/gemini-login.js");
      return new mod.GeminiLogin();
    }
    case "kimi": {
      const mod = await import("../../auth/providers/kimi-login.js");
      return new mod.KimiLogin();
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
