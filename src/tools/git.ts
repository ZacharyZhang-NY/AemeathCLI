/**
 * Git tool — safe git operations via execa. Never force push by default.
 * Per PRD section 5.1
 */

import { execaCommand } from "execa";
import type { IToolRegistration, PermissionMode } from "../types/tool.js";
import type { IToolResult } from "../types/message.js";
import { logger } from "../utils/logger.js";

const GIT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_LENGTH = 30_000;

const ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "status", "diff", "log", "show", "branch", "tag",
  "add", "commit", "checkout", "switch", "merge",
  "rebase", "cherry-pick", "stash", "fetch", "pull", "push",
  "remote", "rev-parse", "describe", "blame",
]);

const DANGEROUS_FLAGS: readonly string[] = [
  "--force", "-f",
  "--force-with-lease",
  "--hard",
  "--no-verify",
  "-D",
];

const READ_ONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "status", "diff", "log", "show", "branch", "tag",
  "remote", "rev-parse", "describe", "blame",
]);

function parseGitSubcommand(command: string): string | undefined {
  const parts = command.trim().split(/\s+/);
  // Expect "git <subcommand> ..."
  if (parts[0] !== "git" || parts.length < 2) {
    return undefined;
  }
  return parts[1];
}

function hasDangerousFlags(command: string): boolean {
  const lowerCommand = command.toLowerCase();
  return DANGEROUS_FLAGS.some((flag) => {
    // Match as whole token
    const pattern = new RegExp(`(^|\\s)${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
    return pattern.test(lowerCommand);
  });
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }
  return output.substring(0, MAX_OUTPUT_LENGTH) + "\n...(truncated)";
}

let workingDirectory = process.cwd();

export function setGitWorkingDirectory(dir: string): void {
  workingDirectory = dir;
}

export function createGitTool(): IToolRegistration {
  return {
    definition: {
      name: "git",
      description:
        "Execute git commands safely. Supports status, diff, log, add, commit, branch operations. Never force pushes by default.",
      parameters: [
        {
          name: "command",
          type: "string",
          description: 'Full git command to execute (e.g. "git status", "git diff HEAD")',
          required: true,
        },
      ],
    },
    category: "git",
    requiresApproval: (mode: PermissionMode, args: Record<string, unknown>): boolean => {
      const command = typeof args["command"] === "string" ? args["command"] : "";
      const subcommand = parseGitSubcommand(command);

      // Dangerous flags always need approval
      if (hasDangerousFlags(command)) {
        return true;
      }

      // Read-only commands never need approval
      if (subcommand && READ_ONLY_SUBCOMMANDS.has(subcommand)) {
        return false;
      }

      // Write commands need approval in strict mode
      if (mode === "strict") {
        return true;
      }

      // Push needs approval in standard mode
      if (subcommand === "push" && mode === "standard") {
        return true;
      }

      return false;
    },
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const command = args["command"];
      if (typeof command !== "string" || command.length === 0) {
        return {
          toolCallId: "",
          name: "git",
          content: "command parameter is required and must be a non-empty string.",
          isError: true,
        };
      }

      const trimmedCommand = command.trim();
      if (!trimmedCommand.startsWith("git ")) {
        return {
          toolCallId: "",
          name: "git",
          content: 'Command must start with "git".',
          isError: true,
        };
      }

      const subcommand = parseGitSubcommand(trimmedCommand);
      if (!subcommand || !ALLOWED_SUBCOMMANDS.has(subcommand)) {
        return {
          toolCallId: "",
          name: "git",
          content: `Git subcommand "${subcommand ?? "unknown"}" is not allowed. Allowed: ${[...ALLOWED_SUBCOMMANDS].join(", ")}`,
          isError: true,
        };
      }

      // Block force push completely
      const lowerCommand = trimmedCommand.toLowerCase();
      if (
        subcommand === "push" &&
        (lowerCommand.includes("--force") || lowerCommand.includes(" -f"))
      ) {
        return {
          toolCallId: "",
          name: "git",
          content:
            "Force push is blocked by default. Use --force-with-lease if needed (requires approval).",
          isError: true,
        };
      }

      logger.debug({ command: trimmedCommand, subcommand, cwd: workingDirectory }, "Executing git command");

      try {
        const result = await execaCommand(trimmedCommand, {
          cwd: workingDirectory,
          timeout: GIT_TIMEOUT_MS,
          reject: false,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_PAGER: "cat",
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
          content += (content.length > 0 ? "\n\nSTDERR:\n" : "") + stderr;
        }
        if (content.length === 0) {
          content = `Git command completed with exit code ${result.exitCode ?? 0}.`;
        }

        const isError = (result.exitCode ?? 0) !== 0;

        return {
          toolCallId: "",
          name: "git",
          content,
          isError,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Git command failed";
        logger.error({ command: trimmedCommand, error: msg }, "Git execution failed");

        return {
          toolCallId: "",
          name: "git",
          content: `Git command failed: ${msg}`,
          isError: true,
        };
      }
    },
  };
}
