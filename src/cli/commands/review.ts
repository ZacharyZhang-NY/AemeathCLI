/**
 * Code review mode command per PRD section 5.1
 */

import { Command } from "commander";
import { runChatCommand } from "../chat-runner.js";

export function createReviewCommand(): Command {
  const review = new Command("review")
    .description("Code review mode with a thorough model")
    .argument("[files...]", "Files to review")
    .option("-m, --model <model>", "Override model (default: review role)")
    .option("--print", "Print a single response and exit")
    .action(async (files: string[], options: Record<string, unknown>) => {
      const message = files.length > 0
        ? `Review these files: ${files.join(", ")}`
        : "Review the recent changes";
      await runChatCommand({
        initialMessage: message,
        model: options["model"] as string | undefined,
        role: "review",
        streaming: true,
        print: options["print"] === true,
      });
    });

  return review;
}
