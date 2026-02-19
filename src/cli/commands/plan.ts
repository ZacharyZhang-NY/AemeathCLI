/**
 * Planning mode command per PRD section 5.1
 */

import { Command } from "commander";

export function createPlanCommand(): Command {
  const plan = new Command("plan")
    .description("Enter planning mode with a high-reasoning model")
    .argument("[message...]", "Planning prompt")
    .option("-m, --model <model>", "Override model (default: planning role)")
    .action(async (messageParts: string[], options: Record<string, unknown>) => {
      const message = messageParts.join(" ");

      const { startChatSession } = await import("../../ui/App.js");

      const model = options["model"] as string | undefined;
      const initialMessage = message || undefined;

      await startChatSession({
        ...(initialMessage !== undefined ? { initialMessage } : {}),
        ...(model !== undefined ? { model } : {}),
        role: "planning",
        streaming: true,
      });
    });

  return plan;
}
