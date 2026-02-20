/**
 * Team management commands per PRD section 8.2
 */

import { Command } from "commander";
import pc from "picocolors";
import type { PaneLayout, IAgentConfig, ModelRole } from "../../types/index.js";
import { SUPPORTED_MODELS } from "../../types/index.js";

const VALID_LAYOUTS: readonly PaneLayout[] = ["auto", "horizontal", "vertical", "grid"];

function isValidLayout(value: string): value is PaneLayout {
  return (VALID_LAYOUTS as readonly string[]).includes(value);
}

function parseAgentCount(raw: string): number | undefined {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return undefined;
  }

  return parsed;
}

function readLegacyModelFromArgv(argv: readonly string[]): string | undefined {
  const teamIndex = argv.indexOf("team");
  if (teamIndex === -1) {
    return undefined;
  }

  const createIndex = argv.indexOf("create", teamIndex + 1);
  if (createIndex === -1) {
    return undefined;
  }

  const scopedArgs = argv.slice(createIndex + 1);
  for (let i = 0; i < scopedArgs.length; i++) {
    const token = scopedArgs[i];
    if (token !== "--model" && token !== "-m") {
      continue;
    }

    const value = scopedArgs[i + 1];
    if (value && !value.startsWith("-")) {
      return value;
    }
  }

  return undefined;
}

async function maybeCreateTmuxSession(
  teamName: string,
  layout: PaneLayout,
  members: readonly IAgentConfig[],
): Promise<{ enabled: boolean; sessionName?: string | undefined }> {
  const { TmuxManager } = await import("../../panes/tmux-manager.js");
  const tmux = new TmuxManager();
  const available = await tmux.isAvailable();

  if (!available) {
    return { enabled: false };
  }

  await tmux.createSession(teamName);
  await tmux.createPanes({
    layout,
    maxPanes: members.length,
    panes: members.map((member, index) => ({
      paneId: `pane-${String(index + 1)}`,
      agentName: member.name,
      model: member.model,
      role: member.role,
      title: `${member.name} | ${member.model}`,
    })),
  });

  return {
    enabled: true,
    sessionName: tmux.getSessionName(),
  };
}

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
      const agentCount = parseAgentCount(options.agents);
      if (agentCount === undefined) {
        process.stderr.write(pc.red("Agent count must be a positive integer\n"));
        process.exitCode = 2;
        return;
      }

      if (!isValidLayout(options.layout)) {
        process.stderr.write(
          pc.red(`Invalid layout: "${options.layout}". Valid: ${VALID_LAYOUTS.join(", ")}\n`),
        );
        process.exitCode = 2;
        return;
      }

      const selectedModel = readLegacyModelFromArgv(process.argv) ?? options.model;

      const modelInfo = SUPPORTED_MODELS[selectedModel];
      if (!modelInfo) {
        process.stderr.write(pc.red(`Unknown model: "${selectedModel}"\n`));
        process.exitCode = 2;
        return;
      }

      process.stdout.write(pc.cyan(`Creating team "${name}" with ${agentCount} agents...\n`));

      try {
        const { TeamManager } = await import("../../teams/team-manager.js");
        const manager = new TeamManager();
        const defaultRole: ModelRole = "coding";

        const agents = Array.from({ length: agentCount }, (_, i) => ({
          name: `agent-${i + 1}`,
          agentType: "general",
          model: selectedModel,
          provider: modelInfo.provider,
          role: defaultRole,
        }));

        const teamConfig = await manager.createTeam(name, { agents });

        const tmuxResult = await maybeCreateTmuxSession(name, options.layout, teamConfig.members)
          .catch(() => ({ enabled: false, sessionName: undefined }));

        if (tmuxResult.enabled) {
          process.stdout.write(
            pc.green(`tmux split-panel ready in session "${tmuxResult.sessionName ?? name}"\n`),
          );
        } else {
          process.stdout.write(
            pc.yellow("tmux unavailable. Falling back to in-process split panel.\n"),
          );
        }

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
        const teams = manager.listTeams();

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

        try {
          const { execa } = await import("execa");
          await execa("tmux", ["kill-session", "-t", `aemeathcli-${name}`]);
        } catch {
          // tmux may be unavailable or session may not exist
        }

        process.stdout.write(pc.green(`Team "${name}" deleted\n`));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Failed to delete team: ${message}\n`));
        process.exitCode = 3;
      }
    });

  return team;
}
