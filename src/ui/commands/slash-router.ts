/**
 * Main slash command router — delegates to per-domain command handlers.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { ModelRole } from "../../types/index.js";
import { SUPPORTED_MODELS, getThinkingConfigForModel } from "../../types/index.js";
import { SLASH_COMMANDS } from "../autocomplete-data.js";
import type { ICommandContext } from "./types.js";
import { addSystemMessage } from "./types.js";
import { resolveModelSelection } from "./model-helpers.js";
import { handleTeamCommand } from "./team-commands.js";
import { handleMcpCommand } from "./mcp-commands.js";
import { handleSkillCommand } from "./skill-commands.js";
import { handleLoginSlashCommand } from "./login-commands.js";
import { handleConfigSlashCommand } from "./config-commands.js";
import { handleHistoryCommand, handleResumeCommand } from "./history-commands.js";

export async function handleInternalCommand(
  input: string,
  switchModel: (model: string) => void,
  switchRole: (role: ModelRole) => void,
  ctx: ICommandContext,
): Promise<void> {
  const parts = input.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  const arg = args[0];

  switch (command) {
    case "/help": {
      const helpLines = SLASH_COMMANDS.map((cmd) => `  ${cmd.command.padEnd(17)}${cmd.description}`).join("\n");
      addSystemMessage(ctx, helpLines);
      break;
    }

    case "/model": {
      if (arg) {
        const resolvedId = resolveModelSelection(arg);
        if (!resolvedId) {
          addSystemMessage(ctx, `Unknown model: ${arg}`);
          break;
        }
        const info = SUPPORTED_MODELS[resolvedId];
        if (!info) {
          addSystemMessage(ctx, `Unknown model: ${arg}`);
          break;
        }
        switchModel(resolvedId);
        const thinkingCfg = getThinkingConfigForModel(resolvedId);
        if (thinkingCfg) {
          const isValid = thinkingCfg.options.some((o) => o.value === ctx.thinkingValue);
          if (!isValid) ctx.setThinkingValue(thinkingCfg.defaultValue);
        }
        addSystemMessage(ctx, `Switched to model: ${info.name}`);
      } else {
        ctx.setSelectionMode({ type: "model" });
      }
      break;
    }

    case "/role": {
      if (arg) {
        const validRoles = ["planning", "coding", "review", "testing", "bugfix", "documentation"];
        if (validRoles.includes(arg)) {
          switchRole(arg as ModelRole);
          addSystemMessage(ctx, `Switched to role: ${arg}`);
        } else {
          addSystemMessage(ctx, `Unknown role: ${arg}\nValid roles: ${validRoles.join(", ")}`);
        }
      } else {
        addSystemMessage(ctx, `Current role: ${ctx.resolution.role ?? "default"}`);
      }
      break;
    }

    case "/cost":
      addSystemMessage(ctx, `Session cost: ${ctx.totalCost} | Tokens: ${ctx.totalTokens}`);
      break;

    case "/clear":
      ctx.setMessages([]);
      break;

    case "/compact":
      ctx.setMessages((prev) => {
        if (prev.length <= 4) return prev;
        const systemMsgs = prev.filter((m) => m.role === "system");
        const recent = prev.filter((m) => m.role !== "system").slice(-4);
        return [...systemMsgs, ...recent];
      });
      addSystemMessage(ctx, `Context compacted — kept last 4 messages. Use /clear to remove all.`);
      break;

    case "/team":
      await handleTeamCommand(args, ctx);
      break;

    case "/mcp":
      await handleMcpCommand(args, ctx);
      break;

    case "/skill":
      await handleSkillCommand(args, ctx);
      break;

    case "/panel": {
      const layout = arg;
      if (!layout) {
        addSystemMessage(
          ctx,
          "Swarm layout is fixed to hub-and-spoke:\n- master agent on the left half\n- worker agents stacked on the right\nUse Shift+Tab to enter swarm mode, then Tab/Ctrl+N to focus agents.",
        );
      } else {
        addSystemMessage(ctx, `Panel layout overrides are disabled. Active swarm layout remains hub-spoke (master left, workers right). Ignored: ${layout}`);
      }
      break;
    }

    case "/login":
      await handleLoginSlashCommand(args, ctx);
      break;

    case "/config":
      await handleConfigSlashCommand(args, ctx);
      break;

    case "/launch":
      addSystemMessage(
        ctx,
        "Swarm orchestration now lives inside the default TUI.\n\n" +
        "Use Shift+Tab to switch into swarm mode, then describe the work you want the team to handle.\n" +
        "The configured master agent will sponsor the team and own the left pane.",
      );
      break;

    case "/history":
      await handleHistoryCommand(ctx);
      break;

    case "/resume":
      await handleResumeCommand(arg, ctx);
      break;

    case "/quit":
    case "/exit": {
      // Graceful shutdown: stop active team before exiting
      const { getActiveTeamManager, getActiveTeamName, getActiveTmuxCleanup } = await import("../team-state.js");
      const teamCleanup = getActiveTmuxCleanup();
      if (teamCleanup) {
        try { await teamCleanup(); } catch { /* best-effort */ }
      }
      const mgr = getActiveTeamManager();
      const name = getActiveTeamName();
      if (mgr && name) {
        try { await mgr.deleteTeam(name); } catch { /* best-effort */ }
      }
      process.exit(0);
      break;
    }

    default:
      addSystemMessage(ctx, `Unknown command: ${command}. Type /help for available commands.`);
  }
}

export { formatThinkingMethod } from "./model-helpers.js";
