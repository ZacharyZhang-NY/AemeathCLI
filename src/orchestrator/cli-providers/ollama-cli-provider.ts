/**
 * CLI provider adapter for Ollama.
 *
 * Manages an Ollama CLI process via PTY, detecting status and extracting
 * responses by parsing terminal output markers:
 * - Idle/prompt: `>>> ` at the start of a line (Ollama's interactive prompt)
 * - Response: text following the last `>>> ` prompt marker
 * - Uses the `model` parameter from BaseCliProvider to select the Ollama model
 */

import { BaseCliProvider } from "./base-cli-provider.js";
import type { TerminalStatus } from "../constants.js";

export class OllamaCliProvider extends BaseCliProvider {
  readonly enterCount = 1;
  readonly extractionRetries = 0;

  getStartCommand(): string {
    return `ollama run ${this.model ?? "llama3"}`;
  }

  getExitCommand(): string {
    return "/bye";
  }

  getIdlePattern(): RegExp {
    return /^>>>\s*/m;
  }

  /**
   * Detect Ollama CLI terminal status.
   *
   * - "completed": Prompt visible in last 200 chars AND output has content
   * - "idle": Prompt visible but minimal output (initial state)
   * - "processing": Default — model is generating
   */
  detectStatus(output: string): TerminalStatus {
    const lastChunk = output.slice(-200);
    const hasPrompt = /^>>>\s*/m.test(lastChunk);

    if (hasPrompt && output.length > 50) return "completed";
    if (hasPrompt) return "idle";
    return "processing";
  }

  /**
   * Extract the last response from Ollama CLI output.
   *
   * Splits output on `>>> ` prompt markers and returns the last segment,
   * which contains the model's most recent response.
   */
  extractLastResponse(output: string): string {
    const parts = output.split(/^>>>\s*/m);
    if (parts.length < 2) throw new Error("No Ollama response");

    const last = parts[parts.length - 1];
    if (!last) throw new Error("Empty Ollama response");

    return last.trim();
  }
}
