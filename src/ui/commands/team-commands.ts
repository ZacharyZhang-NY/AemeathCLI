/**
 * /team slash command handler.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { ICommandContext } from "./types.js";
import { addSystemMessage } from "./types.js";
import {
  getActiveTeamManager,
  getActiveTeamName,
  getActiveTmuxCleanup,
  setActiveTeamManager,
  setActiveTeamName,
  setActiveTmuxCleanup,
} from "../team-state.js";

export async function handleTeamCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "stop") {
    const cleanup = getActiveTmuxCleanup();
    if (cleanup) {
      try {
        await cleanup();
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        addSystemMessage(ctx, `Warning: tmux cleanup failed (${errMsg}). Session may need manual cleanup.`);
      }
      setActiveTmuxCleanup(undefined);
    }

    const manager = getActiveTeamManager();
    const teamName = getActiveTeamName();
    if (manager && teamName) {
      try {
        await manager.deleteTeam(teamName);
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        addSystemMessage(ctx, `Warning: team cleanup failed (${errMsg}). Processes may need manual cleanup.`);
      }
      setActiveTeamManager(undefined);
    }

    setActiveTeamName(undefined);
    ctx.panel.deactivate();
    addSystemMessage(ctx, "Team shut down. All agents stopped. Returned to single-pane mode.");
    return;
  }

  if (subcommand === "list") {
    try {
      const { TeamManager } = await import("../../teams/team-manager.js");
      const manager = new TeamManager();
      const teams = manager.listTeams();
      if (teams.length === 0) {
        addSystemMessage(ctx, "No active teams.");
      } else {
        const lines = teams.map((t) => `  ${t.teamName} — ${t.members.length} agents (${t.status})`);
        addSystemMessage(ctx, lines.join("\n"));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to list teams: ${msg}`);
    }
    return;
  }

  addSystemMessage(
    ctx,
    "Usage: /team list | /team stop\n" +
    "Teams are created automatically from natural language.\n" +
    "Examples: \"Create a team to refactor the auth module\"\n" +
    "          \"I need agents to review this PR from different angles\"",
  );
}
