/**
 * `ac install` — Install an agent profile from a file or URL.
 *
 * Accepts either a local path to a Markdown profile file or
 * a remote URL. The profile is validated and then written to
 * the user agent store (~/.aemeathcli/agent-store/).
 *
 * @see IMPLEMENT_PLAN.md Section 10
 */

import { Command } from "commander";
import pc from "picocolors";

export function createInstallCommand(): Command {
  return new Command("install")
    .description("Install an agent profile from a file or URL")
    .argument("<source>", "Path to .md profile file or URL")
    .action(async (source: string) => {
      try {
        const { ProfileLoader } = await import("../../orchestrator/profiles/profile-loader.js");
        const loader = new ProfileLoader();
        const name = await loader.install(source);
        process.stdout.write(`${pc.green(`Profile "${name}" installed successfully.`)}\n`);
        process.stdout.write(
          `${pc.dim("Stored in the agent profile library for swarm orchestration and advanced profile-driven workflows.")}\n`,
        );
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${pc.red(`Install failed: ${msg}`)}\n`);
        process.exitCode = 1;
      }
    });
}
