/**
 * CLI provider adapter for OpenAI Codex CLI.
 *
 * Manages a Codex CLI process via PTY, detecting status and extracting
 * responses by parsing terminal output markers:
 * - Idle/prompt: `❯`, `›`, or `codex>` prompt
 * - Completion: idle prompt with cost/token footer in last 10 lines
 * - Response: text following the last "Assistant" marker
 */

import { BaseCliProvider } from "./base-cli-provider.js";
import type { TerminalStatus } from "../constants.js";

export class CodexCliProvider extends BaseCliProvider {
  readonly enterCount = 2;
  readonly extractionRetries = 1;

  getStartCommand(): string {
    return "codex --full-auto";
  }

  getExitCommand(): string {
    return "Ctrl-C";
  }

  getIdlePattern(): RegExp {
    return /[❯›]|codex>/;
  }

  /**
   * Detect Codex CLI terminal status.
   *
   * - "completed": Idle prompt visible AND cost/token footer in last 10 lines
   * - "idle": Idle prompt visible but no footer
   * - "processing": Default — CLI is working
   */
  detectStatus(output: string): TerminalStatus {
    const last10 = output.split("\n").slice(-10).join("\n");
    const hasIdle = /[❯›]|codex>/.test(last10);
    const hasFooter = /tokens|cost|\$\d/i.test(last10);

    if (hasIdle && hasFooter) return "completed";
    if (hasIdle) return "idle";
    return "processing";
  }

  /**
   * Extract the last response from Codex CLI output.
   *
   * Finds the last "Assistant" marker and captures text up to
   * the cost/token footer.
   */
  extractLastResponse(output: string): string {
    const idx = output.lastIndexOf("Assistant");
    if (idx === -1) throw new Error("No assistant response found");

    const response = output.slice(idx);
    const footerIdx = response.search(/tokens|cost|\$\d/i);

    return (footerIdx > 0 ? response.slice(0, footerIdx) : response).trim();
  }
}
