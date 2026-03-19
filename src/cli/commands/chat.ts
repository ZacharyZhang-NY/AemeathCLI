/**
 * Interactive chat mode command per PRD section 18.2
 */

import { Command } from "commander";
import { runChatCommand } from "../chat-runner.js";

export function createChatCommand(): Command {
  const chat = new Command("chat")
    .description("Start interactive chat mode (default)")
    .argument("[message...]", "Initial message to send")
    .option("-m, --model <model>", "Override model for this session")
    .option("-r, --role <role>", "Set the task role (planning, coding, review, testing, bugfix)")
    .option("--system <prompt>", "Custom system prompt")
    .option("--print", "Print a single response and exit")
    .option("--no-stream", "Disable streaming output")
    .action(async (messageParts: string[], options: Record<string, unknown>) => {
      await runChatCommand({
        initialMessage: messageParts.join(" ") || undefined,
        model: options["model"] as string | undefined,
        role: options["role"] as string | undefined,
        systemPrompt: options["system"] as string | undefined,
        streaming: options["stream"] !== false,
        print: options["print"] === true,
      });
    });

  return chat;
}
