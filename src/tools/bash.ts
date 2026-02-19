/**
 * Bash tool — shell command execution with timeout, blocklist, and sanitization.
 * Per PRD sections 5.1, 14.4
 */

import { execaCommand } from "execa";
import type { IToolRegistration, PermissionMode } from "../types/tool.js";
import type { IToolResult } from "../types/message.js";
import { ExecutionTimeoutError } from "../types/errors.js";
import { isCommandBlocked, sanitizeShellArg, redactSecrets } from "../utils/sanitizer.js";
import { logger } from "../utils/logger.js";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_OUTPUT_LENGTH = 30_000;

const DANGEROUS_PATTERNS: readonly string[] = [
  "rm -rf /",
  "rm -rf ~",
  "mkfs",
  "dd if=",
  "> /dev/sd",
  "chmod -R 777 /",
  ":(){ :|:& };:",
  "fork bomb",
  "shutdown",
  "reboot",
  "init 0",
  "init 6",
];

const ALWAYS_DANGEROUS_COMMANDS: readonly string[] = [
  "push --force",
  "push -f",
  "reset --hard",
  "clean -fd",
  "branch -D",
  "rm -rf",
  "drop table",
  "drop database",
  "truncate table",
];

const SENSITIVE_ENV_PATTERNS: readonly string[] = [
  "API_KEY",
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "CREDENTIAL",
  "ANTHROPIC_API",
  "OPENAI_API",
  "GOOGLE_API",
  "MOONSHOT_API",
  "KIMI_API",
  "SESSION_TOKEN",
  "REFRESH_TOKEN",
  "ACCESS_TOKEN",
  "PRIVATE_KEY",
];

function filterSensitiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const filtered: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    const upperKey = key.toUpperCase();
    const isSensitive = SENSITIVE_ENV_PATTERNS.some((pattern) => upperKey.includes(pattern));
    if (!isSensitive) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function isDangerousCommand(command: string): boolean {
  const lowerCommand = command.toLowerCase().trim();
  return DANGEROUS_PATTERNS.some((p) => lowerCommand.includes(p)) ||
    ALWAYS_DANGEROUS_COMMANDS.some((p) => lowerCommand.includes(p.toLowerCase()));
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }
  return output.substring(0, MAX_OUTPUT_LENGTH) + "\n...(truncated)";
}

let workingDirectory = process.cwd();
let blockedCommands: readonly string[] = [];

export function setBashWorkingDirectory(dir: string): void {
  workingDirectory = dir;
}

export function setBashBlockedCommands(commands: readonly string[]): void {
  blockedCommands = commands;
}

export function createBashTool(): IToolRegistration {
  return {
    definition: {
      name: "bash",
      description:
        "Execute a shell command. Supports timeout. Dangerous commands require approval.",
      parameters: [
        {
          name: "command",
          type: "string",
          description: "The shell command to execute",
          required: true,
        },
        {
          name: "description",
          type: "string",
          description: "Short description of what this command does",
          required: false,
        },
        {
          name: "timeout",
          type: "number",
          description: "Timeout in milliseconds (max 600000)",
          required: false,
          default: DEFAULT_TIMEOUT_MS,
        },
      ],
    },
    category: "shell",
    requiresApproval: (mode: PermissionMode, args: Record<string, unknown>): boolean => {
      const command = typeof args["command"] === "string" ? args["command"] : "";

      // Dangerous commands always require approval
      if (isDangerousCommand(command) || isCommandBlocked(command, blockedCommands)) {
        return true;
      }

      // Strict mode: all shell commands require approval
      if (mode === "strict") {
        return true;
      }

      return false;
    },
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const command = args["command"];
      if (typeof command !== "string" || command.length === 0) {
        return {
          toolCallId: "",
          name: "bash",
          content: "command parameter is required and must be a non-empty string.",
          isError: true,
        };
      }

      // Block extremely dangerous patterns
      const lowerCommand = command.toLowerCase().trim();
      for (const pattern of DANGEROUS_PATTERNS) {
        if (lowerCommand.includes(pattern)) {
          return {
            toolCallId: "",
            name: "bash",
            content: `Blocked: command matches dangerous pattern "${pattern}".`,
            isError: true,
          };
        }
      }

      if (isCommandBlocked(command, blockedCommands)) {
        return {
          toolCallId: "",
          name: "bash",
          content: "Command is on the blocked list and cannot be executed.",
          isError: true,
        };
      }

      let timeoutMs = DEFAULT_TIMEOUT_MS;
      if (typeof args["timeout"] === "number") {
        timeoutMs = Math.max(1000, Math.min(args["timeout"], MAX_TIMEOUT_MS));
      }

      logger.debug({ command: redactSecrets(command), timeout: timeoutMs, cwd: workingDirectory }, "Executing bash command");

      try {
        const result = await execaCommand(command, {
          cwd: workingDirectory,
          timeout: timeoutMs,
          reject: false,
          shell: true,
          env: {
            ...filterSensitiveEnv(process.env),
            TERM: "dumb",
            NO_COLOR: "1",
          },
          stripFinalNewline: true,
        });

        const stdout = result.stdout ? truncateOutput(result.stdout) : "";
        const stderr = result.stderr ? truncateOutput(result.stderr) : "";

        let content = "";
        if (stdout.length > 0) {
          content += stdout;
        }
        if (stderr.length > 0) {
          content += (content.length > 0 ? "\n\nSTDERR:\n" : "STDERR:\n") + stderr;
        }
        if (content.length === 0) {
          content = `Command completed with exit code ${result.exitCode ?? 0}.`;
        }

        const isError = (result.exitCode ?? 0) !== 0;

        if (isError) {
          content = `Exit code: ${result.exitCode ?? "unknown"}\n${content}`;
        }

        return {
          toolCallId: "",
          name: "bash",
          content,
          isError,
        };
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("timed out")) {
          throw new ExecutionTimeoutError(command, timeoutMs);
        }

        const msg = err instanceof Error ? err.message : "Command execution failed";
        logger.error({ command: redactSecrets(command), error: msg }, "Bash execution failed");

        return {
          toolCallId: "",
          name: "bash",
          content: `Execution failed: ${msg}`,
          isError: true,
        };
      }
    },
  };
}
