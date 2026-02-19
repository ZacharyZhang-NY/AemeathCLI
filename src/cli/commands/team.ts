/**
 * Team management commands per PRD section 8.2
 */

import { Command } from "commander";
import pc from "picocolors";
import type { ProviderName, ModelRole } from "../../types/index.js";

export function createTeamCommand(): Command {
  const team = new Command("team")
    .description("Agent team management");

  team
    .command("create <name>")
    .description("Create a new agent team")
    .option("-a, --agents <count>", "Number of agents", "3")
    .option("-l, --layout <layout>", "Pane layout (auto, horizontal, vertical, grid)", "auto")
    .option("-m, --model <model>", "Default model for agents", "claude-sonnet-4-6")
    .action(async (name: string, options: { agents: string; layout: string; model: string }) => {
      const agentCount = parseInt(options.agents, 10);
      if (isNaN(agentCount) || agentCount < 1 || agentCount > 8) {
        process.stderr.write(pc.red("Agent count must be between 1 and 8\n"));
        process.exitCode = 2;
        return;
      }

      process.stdout.write(pc.cyan(`Creating team "${name}" with ${agentCount} agents...\n`));

      try {
        const { TeamManager } = await import("../../teams/team-manager.js");
        const manager = new TeamManager();

        const agents = Array.from({ length: agentCount }, (_, i) => ({
          name: `agent-${i + 1}`,
          agentType: "general",
          model: options.model,
          provider: "anthropic" as ProviderName,
          role: "coding" as ModelRole,
        }));

        await manager.createTeam(name, { agents });
        process.stdout.write(pc.green(`Team "${name}" created successfully\n`));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Failed to create team: ${message}\n`));
        process.exitCode = 3;
      }
    });

  team
    .command("list")
    .description("List active teams")
    .action(async () => {
      try {
        const { TeamManager } = await import("../../teams/team-manager.js");
        const manager = new TeamManager();
        const teams = await manager.listTeams();

        if (teams.length === 0) {
          process.stdout.write("No active teams\n");
          return;
        }

        for (const t of teams) {
          const statusColor = t.status === "active" ? pc.green : pc.yellow;
          process.stdout.write(
            `  ${statusColor(t.status)} ${pc.bold(t.teamName)} — ${t.members.length} agents\n`,
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Failed to list teams: ${message}\n`));
        process.exitCode = 3;
      }
    });

  team
    .command("delete <name>")
    .description("Delete a team and clean up resources")
    .action(async (name: string) => {
      try {
        const { TeamManager } = await import("../../teams/team-manager.js");
        const manager = new TeamManager();
        await manager.deleteTeam(name);
        process.stdout.write(pc.green(`Team "${name}" deleted\n`));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Failed to delete team: ${message}\n`));
        process.exitCode = 3;
      }
    });

  return team;
}
