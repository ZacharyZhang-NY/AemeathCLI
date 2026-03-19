/**
 * Testing mode command per PRD section 5.1
 */

import { Command } from "commander";
import { runChatCommand } from "../chat-runner.js";

export function createTestCommand(): Command {
  const test = new Command("test")
    .description("Testing mode with a cost-efficient model")
    .argument("[message...]", "Testing prompt")
    .option("-m, --model <model>", "Override model (default: testing role)")
    .option("--print", "Print a single response and exit")
    .action(async (messageParts: string[], options: Record<string, unknown>) => {
      await runChatCommand({
        initialMessage: messageParts.join(" ") || "Generate tests for the recent changes",
        model: options["model"] as string | undefined,
        role: "testing",
        streaming: true,
        print: options["print"] === true,
      });
    });

  return test;
}
