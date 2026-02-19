/**
 * Interactive chat mode command per PRD section 18.2
 */

import { Command } from "commander";
import type { IGlobalFlags } from "../flags.js";

export function createChatCommand(): Command {
  const chat = new Command("chat")
    .description("Start interactive chat mode (default)")
    .argument("[message...]", "Initial message to send")
    .option("-m, --model <model>", "Override model for this session")
    .option("-r, --role <role>", "Set the task role (planning, coding, review, testing, bugfix)")
    .option("--system <prompt>", "Custom system prompt")
    .option("--no-stream", "Disable streaming output")
    .action(async (messageParts: string[], options: Record<string, unknown>) => {
      const message = messageParts.join(" ");

      // Lazy-load the TUI to keep startup fast
      const { startChatSession } = await import("../../ui/App.js");

      const model = options["model"] as string | undefined;
      const role = options["role"] as string | undefined;
      const systemPrompt = options["system"] as string | undefined;
      const initialMessage = message || undefined;

      await startChatSession({
        ...(initialMessage !== undefined ? { initialMessage } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(systemPrompt !== undefined ? { systemPrompt } : {}),
        streaming: options["stream"] !== false,
      });
    });

  return chat;
}
