/**
 * Testing mode command per PRD section 5.1
 */

import { Command } from "commander";

export function createTestCommand(): Command {
  const test = new Command("test")
    .description("Testing mode with a cost-efficient model")
    .argument("[message...]", "Testing prompt")
    .option("-m, --model <model>", "Override model (default: testing role)")
    .action(async (messageParts: string[], options: Record<string, unknown>) => {
      const message = messageParts.join(" ");

      const { startChatSession } = await import("../../ui/App.js");

      const model = options["model"] as string | undefined;

      await startChatSession({
        initialMessage: message || "Generate tests for the recent changes",
        ...(model !== undefined ? { model } : {}),
        role: "testing",
        streaming: true,
      });
    });

  return test;
}
