/**
 * CLI provider adapter for Google Gemini CLI.
 *
 * Manages a Gemini CLI process via PTY, detecting status and extracting
 * responses by parsing terminal output markers:
 * - Idle/prompt: `*`, `◆`, or `✦` followed by "Type your message"
 * - Response blocks: delimited by `✦` markers
 * - Higher extraction retries (2) due to TUI spinner behavior
 */

import { BaseCliProvider } from "./base-cli-provider.js";
import type { TerminalStatus } from "../constants.js";

export class GeminiCliProvider extends BaseCliProvider {
  readonly enterCount = 1;
  readonly extractionRetries = 2;

  getStartCommand(): string {
    return "gemini --yolo";
  }

  getExitCommand(): string {
    return "/quit";
  }

  getIdlePattern(): RegExp {
    return /[*◆✦]\s+Type your message/i;
  }

  /**
   * Detect Gemini CLI terminal status.
   *
   * - "completed": Idle prompt in last 500 chars AND response marker (✦) present
   * - "idle": Idle prompt in last 500 chars but no response marker
   * - "processing": Default — CLI is working
   */
  detectStatus(output: string): TerminalStatus {
    const lastChunk = output.slice(-500);
    const hasIdle = /[*◆✦]\s+Type your message/i.test(lastChunk);
    const hasResponse = /✦/.test(output);

    if (hasIdle && hasResponse) return "completed";
    if (hasIdle) return "idle";
    return "processing";
  }

  /**
   * Extract the last response from Gemini CLI output.
   *
   * Splits output on `✦` markers and takes the last block,
   * then strips the trailing "Type your message" prompt.
   */
  extractLastResponse(output: string): string {
    const parts = output.split(/✦/);
    if (parts.length < 2) throw new Error("No Gemini response marker");

    const last = parts[parts.length - 1];
    if (!last) throw new Error("Empty Gemini response");

    return last.replace(/[*◆]\s+Type your message.*$/s, "").trim();
  }
}
