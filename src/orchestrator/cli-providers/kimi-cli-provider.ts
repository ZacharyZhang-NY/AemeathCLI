/**
 * CLI provider adapter for Kimi CLI (Moonshot AI).
 *
 * Manages a Kimi CLI process via PTY, detecting status and extracting
 * responses by parsing terminal output markers:
 * - Idle/prompt: `> ` at the start of a line
 * - Response: text between two `> ` prompt lines
 */

import { BaseCliProvider } from "./base-cli-provider.js";
import type { TerminalStatus } from "../constants.js";

export class KimiCliProvider extends BaseCliProvider {
  readonly enterCount = 2;
  readonly extractionRetries = 0;

  getStartCommand(): string {
    return "kimi --yolo";
  }

  getExitCommand(): string {
    return "/exit";
  }

  getIdlePattern(): RegExp {
    return /^>\s/m;
  }

  /**
   * Detect Kimi CLI terminal status.
   *
   * - "completed": Prompt visible in last 300 chars AND output has substantive content
   * - "idle": Prompt visible but minimal output (initial state)
   * - "processing": Default — CLI is working
   */
  detectStatus(output: string): TerminalStatus {
    const lastChunk = output.slice(-300);
    const hasPrompt = /^>\s/m.test(lastChunk);

    if (hasPrompt && output.length > 100) return "completed";
    if (hasPrompt) return "idle";
    return "processing";
  }

  /**
   * Extract the last response from Kimi CLI output.
   *
   * Scans backwards through lines to find the response text
   * between the last two `> ` prompt markers.
   */
  extractLastResponse(output: string): string {
    const lines = output.split("\n");
    let start = -1;
    let end = lines.length;

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line !== undefined && /^>\s/.test(line)) {
        if (start === -1) {
          end = i;
        } else {
          start = i + 1;
          break;
        }
      }
    }

    return lines.slice(Math.max(start, 0), end).join("\n").trim();
  }
}
