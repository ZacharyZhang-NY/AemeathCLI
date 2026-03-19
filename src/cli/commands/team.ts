import { Command } from "commander";
import pc from "picocolors";

export function createTeamCommand(): Command {
  return new Command("team")
    .description("Legacy team namespace")
    .argument("[legacy...]", "Legacy team arguments")
    .action((legacyArgs: string[]) => {
      const attempted = legacyArgs.length > 0 ? `team ${legacyArgs.join(" ")}` : "team";
      process.stderr.write(
        pc.yellow(
          `The top-level \`${attempted}\` command is deprecated.\n` +
          "Start `aemeathcli` (or `ac`), press Shift+Tab for swarm mode, or use `/team` inside the interactive session.\n",
        ),
      );
      process.exitCode = 2;
    });
}
