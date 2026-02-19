/**
 * Code review mode command per PRD section 5.1
 */

import { Command } from "commander";

export function createReviewCommand(): Command {
  const review = new Command("review")
    .description("Code review mode with a thorough model")
    .argument("[files...]", "Files to review")
    .option("-m, --model <model>", "Override model (default: review role)")
    .action(async (files: string[], options: Record<string, unknown>) => {
      const message = files.length > 0
        ? `Review these files: ${files.join(", ")}`
        : "Review the recent changes";

      const { startChatSession } = await import("../../ui/App.js");

      const model = options["model"] as string | undefined;

      await startChatSession({
        initialMessage: message,
        ...(model !== undefined ? { model } : {}),
        role: "review",
        streaming: true,
      });
    });

  return review;
}
