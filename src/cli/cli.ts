#!/usr/bin/env node

import { Command } from "commander";
import updateNotifier from "update-notifier";
import { createAuthCommand, createLoginCommand } from "./commands/auth.js";
import { createChatCommand } from "./commands/chat.js";
import { createConfigCommand } from "./commands/config.js";
import { createInstallCommand } from "./commands/install.js";
import { createPlanCommand } from "./commands/plan.js";
import { createReviewCommand } from "./commands/review.js";
import { createTeamCommand } from "./commands/team.js";
import { createTestCommand } from "./commands/test.js";
import { runChatCommand } from "./chat-runner.js";
import { PACKAGE_VERSION } from "../version.js";

updateNotifier({
  pkg: {
    name: "aemeathcli",
    version: PACKAGE_VERSION,
  },
  updateCheckInterval: 1000 * 60 * 60 * 12,
}).notify({ isGlobal: true });

async function main(): Promise<void> {
  const program = new Command("aemeathcli")
    .version(PACKAGE_VERSION)
    .description("Aemeath CLI — multi-agent coding assistant")
    .argument("[message...]", "Start a chat session with an initial message")
    .option("-m, --model <model>", "Override model for this session")
    .option("-r, --role <role>", "Set the task role")
    .option("--system <prompt>", "Custom system prompt")
    .option("--print", "Print a single response and exit")
    .action(async (messageParts: string[], options: Record<string, unknown>) => {
      await runChatCommand({
        initialMessage: messageParts.join(" ") || undefined,
        model: options["model"] as string | undefined,
        role: options["role"] as string | undefined,
        systemPrompt: options["system"] as string | undefined,
        print: options["print"] === true,
      });
    });

  program.addCommand(createChatCommand());
  program.addCommand(createPlanCommand());
  program.addCommand(createReviewCommand());
  program.addCommand(createTestCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createAuthCommand());
  program.addCommand(createLoginCommand());
  program.addCommand(createInstallCommand());
  program.addCommand(createTeamCommand());

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
