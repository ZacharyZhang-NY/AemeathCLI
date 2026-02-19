#!/usr/bin/env node

/**
 * AemeathCLI — Main CLI entry point
 * Per PRD section 6.1: Commander.js setup with subcommand routing
 */

import { Command } from "commander";
import pc from "picocolors";
import { createChatCommand } from "./commands/chat.js";
import { createPlanCommand } from "./commands/plan.js";
import { createReviewCommand } from "./commands/review.js";
import { createTestCommand } from "./commands/test.js";
import { createTeamCommand } from "./commands/team.js";
import { createConfigCommand } from "./commands/config.js";
import { createAuthCommand } from "./commands/auth.js";
import { initializeDirectories, findProjectRoot } from "../utils/index.js";
import { logger } from "../utils/index.js";

const VERSION = "1.0.0";

async function main(): Promise<void> {
  // Initialize directories on startup
  initializeDirectories();

  const program = new Command()
    .name("aemeathcli")
    .description(
      "Next-generation multi-model CLI coding tool with agent teams and split-panel coordination",
    )
    .version(VERSION, "-v, --version")
    .option("-m, --model <model>", "Override model for this session")
    .option("-r, --role <role>", "Set the task role")
    .option("--verbose", "Enable verbose output")
    .option("--no-color", "Disable colored output")
    .option("--permission-mode <mode>", "Permission mode (strict, standard, permissive)")
    .option("--project-root <path>", "Override project root detection");

  // Register subcommands
  program.addCommand(createChatCommand());
  program.addCommand(createPlanCommand());
  program.addCommand(createReviewCommand());
  program.addCommand(createTestCommand());
  program.addCommand(createTeamCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createAuthCommand());

  // Default action (no subcommand) — start interactive chat
  program.action(async (options: Record<string, unknown>, command: Command) => {
    // If extra arguments provided, treat as chat message
    const args = command.args;
    const message = args.length > 0 ? args.join(" ") : undefined;

    const { startChatSession } = await import("../ui/App.js");

    const model = options["model"] as string | undefined;
    const role = options["role"] as string | undefined;

    await startChatSession({
      ...(message !== undefined ? { initialMessage: message } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(role !== undefined ? { role } : {}),
      streaming: true,
    });
  });

  // Check for updates (non-blocking, per PRD section 19.3)
  checkForUpdates();

  // Parse and execute
  try {
    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error({ error: error.message }, "CLI error");
      process.stderr.write(pc.red(`Error: ${error.message}\n`));
    }
    process.exitCode = 1;
  }
}

function checkForUpdates(): void {
  // Lazy-load to keep startup fast
  import("update-notifier")
    .then(({ default: updateNotifier }) => {
      const notifier = updateNotifier({
        pkg: { name: "aemeathcli", version: VERSION },
        updateCheckInterval: 1000 * 60 * 60 * 24, // 24 hours
      });
      notifier.notify({ isGlobal: true });
    })
    .catch(() => {
      // Silently ignore update check failures
    });
}

main().catch((error: unknown) => {
  process.stderr.write(
    pc.red(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`),
  );
  process.exit(1);
});
