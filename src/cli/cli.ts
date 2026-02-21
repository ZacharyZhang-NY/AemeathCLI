#!/usr/bin/env node

/**
 * AemeathCLI — Main CLI entry point
 * Per PRD section 6.1: Commander.js setup with subcommand routing
 */

import { Command } from "commander";
import pc from "picocolors";
import { randomUUID } from "node:crypto";
import { createChatCommand } from "./commands/chat.js";
import { createPlanCommand } from "./commands/plan.js";
import { createReviewCommand } from "./commands/review.js";
import { createTestCommand } from "./commands/test.js";
import { createConfigCommand } from "./commands/config.js";
import { createAuthCommand, createLoginCommand } from "./commands/auth.js";
import { initializeDirectories } from "../utils/index.js";
import { logger } from "../utils/index.js";
import type { IIPCMessage } from "../types/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { IChatMessage, IToolCall } from "../types/message.js";

const VERSION = "1.0.0";

function getFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
}

function isIPCMessage(value: unknown): value is IIPCMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record["jsonrpc"] === "2.0" && typeof record["method"] === "string";
}

function sendAgentIPC(method: IIPCMessage["method"], params: Record<string, unknown>): void {
  if (typeof process.send === "function") {
    const message: IIPCMessage = {
      jsonrpc: "2.0",
      method,
      params,
    };
    process.send(message);
  }
}

async function maybeRunAgentMode(args: readonly string[]): Promise<boolean> {
  if (!args.includes("--agent") && process.env["AEMEATHCLI_AGENT_MODE"] !== "1") {
    return false;
  }

  const teamName = getFlagValue(args, "--team") ?? process.env["AEMEATHCLI_TEAM_NAME"] ?? "unknown-team";
  const agentName = getFlagValue(args, "--name") ?? process.env["AEMEATHCLI_AGENT_NAME"] ?? "agent";
  const model = getFlagValue(args, "--model") ?? "claude-sonnet-4-6";
  const role = getFlagValue(args, "--role") ?? "coding";
  const agentId = process.env["AEMEATHCLI_AGENT_ID"] ?? randomUUID();

  // Lazily-initialized provider registry (shared across tasks for this agent)
  let registryPromise: Promise<ProviderRegistry> | undefined;

  function getRegistry(): Promise<ProviderRegistry> {
    if (!registryPromise) {
      registryPromise = import("../providers/registry.js").then(
        ({ createDefaultRegistry }) => createDefaultRegistry(),
      );
    }
    return registryPromise;
  }

  // Lazily-initialized tool registry (shared across tasks for this agent)
  let toolRegistryPromise: Promise<ToolRegistry> | undefined;

  function getToolRegistry(): Promise<ToolRegistry> {
    if (!toolRegistryPromise) {
      toolRegistryPromise = import("../tools/index.js").then(
        ({ createDefaultRegistry: createToolReg }) =>
          createToolReg({
            projectRoot: process.cwd(),
            workingDirectory: process.cwd(),
            permissionMode: "permissive" as const,
            allowedPaths: [process.cwd()],
            blockedCommands: [],
          }),
      );
    }
    return toolRegistryPromise;
  }

  /** Format a one-line summary of a tool call for the agent output panel. */
  function formatToolActivity(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case "read":
      case "write":
      case "edit":
        return typeof args["file_path"] === "string" ? args["file_path"] : "";
      case "glob":
        return typeof args["pattern"] === "string" ? args["pattern"] : "";
      case "grep": {
        const pat = typeof args["pattern"] === "string" ? args["pattern"] : "";
        const dir = typeof args["path"] === "string" ? ` in ${args["path"]}` : "";
        return `"${pat}"${dir}`;
      }
      case "bash": {
        const cmd = typeof args["command"] === "string" ? args["command"] : "";
        return cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
      }
      default:
        return JSON.stringify(args).slice(0, 60);
    }
  }

  /** Short summary of a tool result for the activity feed. */
  function formatResultSummary(name: string, content: string, isError: boolean): string {
    if (isError) return `Error: ${content.slice(0, 100)}`;
    const lines = content.split("\n").length;
    switch (name) {
      case "read": return `${lines} lines`;
      case "glob": return content === "No files found" ? "no files" : `${lines} files`;
      case "grep": return content === "No matches found." ? "no matches" : `${lines} lines`;
      case "write":
      case "edit": return content.length > 80 ? content.slice(0, 80) : content;
      default: return content.length > 80 ? content.slice(0, 80) + "..." : content;
    }
  }

  const MAX_TOOL_ITERATIONS = 10;
  const MAX_TOOL_RESULT_LENGTH = 10_000;

  async function processTask(taskId: string, prompt: string): Promise<void> {
    sendAgentIPC("agent.taskUpdate", { agentId, taskId, status: "in_progress" });
    sendAgentIPC("agent.streamChunk", {
      agentId, taskId, model,
      content: `Initializing provider for ${model}...\n`,
    });

    try {
      const registry = await getRegistry();

      if (!registry.hasModel(model)) {
        sendAgentIPC("agent.streamChunk", {
          agentId, taskId, model,
          content: `\nError: No provider available for model "${model}". Check authentication with 'aemeathcli auth login'.\n`,
        });
        sendAgentIPC("agent.taskUpdate", { agentId, taskId, status: "completed" });
        return;
      }

      const provider = registry.getForModel(model);
      sendAgentIPC("agent.streamChunk", {
        agentId, taskId, model,
        content: `Provider ready (${provider.name}). Loading tools...\n`,
      });
      const toolRegistry = await getToolRegistry();
      const toolDefs = toolRegistry.getDefinitions();
      sendAgentIPC("agent.streamChunk", {
        agentId, taskId, model,
        content: `${toolDefs.length} tools loaded. Sending request to ${model}...\n`,
      });
      const toolContext = {
        projectRoot: process.cwd(),
        workingDirectory: process.cwd(),
        permissionMode: "permissive" as const,
        allowedPaths: [process.cwd()],
        blockedCommands: [] as string[],
      };

      const systemPrompt = `You are ${agentName}, an AI agent in team "${teamName}" with the role of ${role}. You have access to tools for reading files, writing files, editing code, searching, and executing shell commands. Use these tools to complete the assigned task thoroughly. Focus only on your specific role.`;

      const messages: IChatMessage[] = [{
        id: randomUUID(),
        role: "user" as const,
        content: prompt,
        createdAt: new Date(),
      }];

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        let collectedText = "";
        const collectedToolCalls: IToolCall[] = [];

        const stream = provider.stream({
          model,
          messages,
          system: systemPrompt,
          maxTokens: 8000,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
        });

        for await (const chunk of stream) {
          if (chunk.type === "text" && chunk.content) {
            collectedText += chunk.content;
            sendAgentIPC("agent.streamChunk", {
              agentId, taskId, model,
              content: chunk.content,
            });
          } else if (chunk.type === "tool_call" && chunk.toolCall) {
            collectedToolCalls.push(chunk.toolCall);
            const tc = chunk.toolCall;
            const summary = formatToolActivity(tc.name, tc.arguments);
            sendAgentIPC("agent.streamChunk", {
              agentId, taskId, model,
              content: `\n\u2699 ${tc.name} ${summary}\n`,
            });
          } else if (chunk.type === "error" && chunk.error) {
            // Truncate error messages to prevent raw CLI output dumps
            const errorMsg = chunk.error.length > 300
              ? chunk.error.slice(0, 300) + "..."
              : chunk.error;
            sendAgentIPC("agent.streamChunk", {
              agentId, taskId, model,
              content: `\nStream error: ${errorMsg}\n`,
            });
          }
        }

        // No tool calls → agent finished
        if (collectedToolCalls.length === 0) {
          break;
        }

        // Add assistant message with tool calls to conversation
        messages.push({
          id: randomUUID(),
          role: "assistant" as const,
          content: collectedText,
          toolCalls: collectedToolCalls,
          createdAt: new Date(),
        });

        // Execute each tool call and add results
        for (const tc of collectedToolCalls) {
          const result = await toolRegistry.execute(tc, toolContext);

          const briefResult = formatResultSummary(tc.name, result.content, result.isError);
          sendAgentIPC("agent.streamChunk", {
            agentId, taskId, model,
            content: `  \u2192 ${briefResult}\n`,
          });

          const truncatedContent = result.content.length > MAX_TOOL_RESULT_LENGTH
            ? result.content.slice(0, MAX_TOOL_RESULT_LENGTH) + "\n...(truncated)"
            : result.content;

          messages.push({
            id: randomUUID(),
            role: "tool" as const,
            content: truncatedContent,
            toolCalls: [{ id: tc.id, name: tc.name, arguments: {} }],
            createdAt: new Date(),
          });
        }
      }
    } catch (error: unknown) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      // Truncate to prevent raw CLI output from flooding the panel
      const msg = rawMsg.length > 300 ? rawMsg.slice(0, 300) + "..." : rawMsg;
      sendAgentIPC("agent.streamChunk", {
        agentId, taskId, model,
        content: `\nError: ${msg}\n`,
      });
    }

    sendAgentIPC("agent.taskUpdate", { agentId, taskId, status: "completed" });
  }

  sendAgentIPC("agent.register", {
    agentId,
    agentName,
    teamName,
    model,
    role,
  });

  const keepAlive = setInterval(() => {
    // Keep event loop alive for IPC mode.
  }, 60_000);

  const shutdown = (): void => {
    clearInterval(keepAlive);
    process.exit(0);
  };

  process.on("message", (raw: unknown) => {
    if (!isIPCMessage(raw)) {
      return;
    }

    if (raw.method === "hub.taskAssign") {
      const taskId = typeof raw.params["taskId"] === "string"
        ? raw.params["taskId"]
        : randomUUID();
      const subject = typeof raw.params["subject"] === "string"
        ? raw.params["subject"]
        : "";
      const description = typeof raw.params["description"] === "string"
        ? raw.params["description"]
        : "";

      void processTask(taskId, description || subject || "Describe what you can help with.");
      return;
    }

    if (raw.method === "hub.shutdown") {
      shutdown();
    }
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep the child process alive for IPC task dispatch.
  await new Promise<void>(() => {});
  return true;
}

async function main(): Promise<void> {
  if (await maybeRunAgentMode(process.argv.slice(2))) {
    return;
  }

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
  program.addCommand(createConfigCommand());
  program.addCommand(createAuthCommand());
  program.addCommand(createLoginCommand());

  // Default action (no subcommand) — start interactive chat
  program.action(async (options: Record<string, unknown>, command: Command) => {
    // If extra arguments provided, treat as chat message
    const args = command.args;
    let message = args.length > 0 ? args.join(" ") : undefined;

    // Support reading initial prompt from file (used by split-panel mode
    // where each agent pane is launched with AEMEATHCLI_PROMPT_FILE pointing
    // to a temp file containing the agent's task prompt).
    let isAgentPane = false;
    if (message === undefined) {
      const promptFilePath = process.env["AEMEATHCLI_PROMPT_FILE"];
      if (promptFilePath !== undefined && promptFilePath.length > 0) {
        try {
          const { readFileSync } = await import("node:fs");
          message = readFileSync(promptFilePath, "utf-8").trim();
          isAgentPane = true;
        } catch {
          // Prompt file not found — continue without initial message
        }
      }
    }

    const { startChatSession } = await import("../ui/App.js");

    const model = options["model"] as string | undefined;
    const role = options["role"] as string | undefined;

    await startChatSession({
      ...(message !== undefined ? { initialMessage: message } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(isAgentPane ? { isAgentPane: true } : {}),
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
