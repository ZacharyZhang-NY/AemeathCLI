/**
 * Planning mode command per PRD section 5.1
 */

import { Command } from "commander";
import { runChatCommand } from "../chat-runner.js";

export function createPlanCommand(): Command {
  const plan = new Command("plan")
    .description("Enter planning mode with a high-reasoning model")
    .argument("[message...]", "Planning prompt")
    .option("-m, --model <model>", "Override model (default: planning role)")
    .option("--print", "Print a single response and exit")
    .action(async (messageParts: string[], options: Record<string, unknown>) => {
      await runChatCommand({
        initialMessage: messageParts.join(" ") || undefined,
        model: options["model"] as string | undefined,
        role: "planning",
        streaming: true,
        print: options["print"] === true,
      });
    });

  return plan;
}
