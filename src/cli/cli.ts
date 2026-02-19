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
import { createTeamCommand } from "./commands/team.js";
import { createConfigCommand } from "./commands/config.js";
import { createAuthCommand } from "./commands/auth.js";
import { initializeDirectories } from "../utils/index.js";
import { logger } from "../utils/index.js";
import type { IIPCMessage } from "../types/index.js";

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

      sendAgentIPC("agent.taskUpdate", {
        agentId,
        taskId,
        status: "in_progress",
      });

      sendAgentIPC("agent.streamChunk", {
        agentId,
        taskId,
        model,
        content: `[${agentName}] received task ${taskId}`,
      });

      sendAgentIPC("agent.taskUpdate", {
        agentId,
        taskId,
        status: "completed",
      });
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
  program.addCommand(createTeamCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createAuthCommand());

  // Default action (no subcommand) — start interactive chat
  program.action(async (options: Record<string, unknown>, command: Command) => {
    // If extra arguments provided, treat as chat message
    const args = command.args;
    const message = args.length > 0 ? args.join(" ") : undefined;

    const { startChatSession } = await import("../ui/App.js");

    const model = options["model"] as string | undefined;
    const role = options["role"] as string | undefined;

    await startChatSession({
      ...(message !== undefined ? { initialMessage: message } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(role !== undefined ? { role } : {}),
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
