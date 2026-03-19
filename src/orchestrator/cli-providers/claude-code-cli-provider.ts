/**
 * CLI provider adapter for Claude Code (Anthropic).
 *
 * Manages a Claude Code CLI process via PTY, detecting status and extracting
 * responses by parsing terminal output markers:
 * - Idle/prompt: `>` or `❯` followed by whitespace
 * - Response blocks: delimited by `⏺` markers
 * - Permission prompts: "Allow", "Deny", "approve" keywords
 */

import { BaseCliProvider } from "./base-cli-provider.js";
import type { TerminalStatus } from "../constants.js";

export class ClaudeCodeCliProvider extends BaseCliProvider {
  readonly enterCount = 2;
  readonly extractionRetries = 0;

  getStartCommand(): string {
    return "claude --dangerously-skip-permissions";
  }

  getExitCommand(): string {
    return "/exit";
  }

  getIdlePattern(): RegExp {
    return /[>❯][\s\xa0]/;
  }

  /**
   * Detect Claude Code terminal status.
   *
   * - "waiting_user_answer": Permission prompt detected (Allow/Deny/approve)
   * - "completed": Idle prompt visible AND response marker (⏺) present
   * - "idle": Idle prompt visible but no response marker
   * - "processing": Default — CLI is working
   */
  detectStatus(output: string): TerminalStatus {
    if (/Allow|Deny|approve/i.test(output)) return "waiting_user_answer";

    const last5 = output.split("\n").slice(-5).join("\n");
    const hasIdle = /[>❯][\s\xa0]/.test(last5);
    const hasResponse = /⏺/.test(output);

    if (hasIdle && hasResponse) return "completed";
    if (hasIdle) return "idle";
    return "processing";
  }

  /**
   * Extract the last response from Claude Code output.
   *
   * Splits output on `⏺` markers and takes the last block,
   * then strips the trailing prompt line.
   */
  extractLastResponse(output: string): string {
    const blocks = output.split(/⏺/);
    if (blocks.length < 2) throw new Error("No response marker found");

    const last = blocks[blocks.length - 1];
    if (!last) throw new Error("Empty response block");

    return last.replace(/\n[>❯][\s\xa0].*$/s, "").trim();
  }
}
