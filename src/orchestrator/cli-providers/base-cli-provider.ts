/**
 * Abstract base class for CLI provider adapters.
 *
 * CLI providers manage interactive CLI tool processes via PTY sessions.
 * They detect terminal status and extract responses by parsing terminal output.
 * This is distinct from the SDK-based IModelProvider adapters in src/providers/.
 */

import type { TerminalStatus } from "../constants.js";
import type { PtySessionManager } from "../pty/session-manager.js";
import { sleep } from "../utils/helpers.js";
import {
  PROVIDER_INIT_TIMEOUT_MS,
  TAIL_BUFFER_LINES,
  STATUS_POLL_INTERVAL_MS,
  SHELL_READY_TIMEOUT_MS,
  MAX_OUTPUT_EXTRACT_BYTES,
} from "../constants.js";

export type { CliProviderType } from "../constants.js";

/**
 * BaseCliProvider — abstract adapter for CLI-based AI tools.
 *
 * Subclasses implement provider-specific logic for:
 * - Starting and exiting the CLI tool
 * - Detecting terminal status (idle, processing, completed, etc.)
 * - Extracting the last response from terminal output
 *
 * The base class provides shared lifecycle management:
 * - Shell readiness detection
 * - Provider initialization
 * - Status polling with timeout
 * - Task submission
 * - Graceful exit (including Ctrl-key sequences)
 * - Response extraction with retry logic
 */
export abstract class BaseCliProvider {
  constructor(
    protected readonly terminalId: string,
    protected readonly sessionManager: PtySessionManager,
    protected readonly model?: string,
  ) {}

  /** Number of enter key presses required to submit input. */
  abstract readonly enterCount: number;

  /** Number of extraction retries before falling back to raw output. */
  abstract readonly extractionRetries: number;

  /** Command to launch the CLI tool (e.g. "claude --dangerously-skip-permissions"). */
  abstract getStartCommand(): string;

  /** Command or key sequence to exit the CLI tool (e.g. "/exit" or "Ctrl-C"). */
  abstract getExitCommand(): string;

  /** Detect the current terminal status from cleaned output. */
  abstract detectStatus(cleanOutput: string): TerminalStatus;

  /** Regex pattern matching the idle/prompt state. */
  abstract getIdlePattern(): RegExp;

  /** Extract the last assistant response from cleaned output. */
  abstract extractLastResponse(cleanOutput: string): string;

  /**
   * Initialize the CLI provider:
   * 1. Wait for the shell to be ready
   * 2. Launch the CLI tool
   * 3. Wait until the tool reaches an idle or completed state
   */
  async initialize(): Promise<void> {
    await this.waitForShellReady();
    this.sessionManager.writeLine(this.terminalId, this.getStartCommand());
    const ready = await this.waitUntilStatus(["idle", "completed"], PROVIDER_INIT_TIMEOUT_MS);
    if (!ready) {
      throw new Error(`${this.constructor.name} failed to become ready`);
    }
  }

  /** Get the current terminal status by reading the tail buffer. */
  getStatus(): TerminalStatus {
    return this.detectStatus(
      this.sessionManager.getCleanTail(this.terminalId, TAIL_BUFFER_LINES),
    );
  }

  /**
   * Poll until the terminal reaches one of the target statuses.
   * Returns true if a target status was reached, false on timeout or error.
   */
  async waitUntilStatus(
    targets: TerminalStatus[],
    timeoutMs: number,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = this.getStatus();
      if (targets.includes(status)) return true;
      if (status === "error") return false;
      await sleep(STATUS_POLL_INTERVAL_MS);
    }
    return false;
  }

  /** Send a task message to the CLI tool with the appropriate number of enter presses. */
  async sendTask(message: string): Promise<void> {
    await this.sessionManager.writeWithEnters(
      this.terminalId,
      message,
      this.enterCount,
    );
  }

  /**
   * Exit the CLI tool gracefully.
   * Supports both text commands (e.g. "/exit") and Ctrl-key sequences (e.g. "Ctrl-C").
   */
  exit(): void {
    const cmd = this.getExitCommand();
    if (cmd.startsWith("Ctrl-")) {
      const letter = cmd.replace("Ctrl-", "");
      const charCode = letter.charCodeAt(0) - 64;
      this.sessionManager
        .getSession(this.terminalId)
        .pty.write(String.fromCharCode(charCode));
    } else {
      this.sessionManager.writeLine(this.terminalId, cmd);
    }
  }

  /**
   * Extract the last response with retry logic.
   * Re-reads the buffer on each attempt to account for delayed output.
   * Falls back to raw tail output if all extraction attempts fail.
   */
  async extractWithRetry(): Promise<string> {
    for (let attempt = 0; attempt <= this.extractionRetries; attempt++) {
      try {
        const output = this.sessionManager.getFilteredOutput(this.terminalId);
        return this.extractLastResponse(output);
      } catch {
        if (attempt < this.extractionRetries) {
          await sleep(5_000);
        }
      }
    }
    // Fallback: return the last chunk of raw filtered output
    return this.sessionManager
      .getFilteredOutput(this.terminalId)
      .slice(-MAX_OUTPUT_EXTRACT_BYTES);
  }

  /**
   * Wait for the shell to be ready before launching the CLI tool.
   * Detects readiness by checking for stable (non-changing) non-empty output.
   */
  private async waitForShellReady(): Promise<void> {
    let last = "";
    let stable = 0;
    const start = Date.now();
    while (Date.now() - start < SHELL_READY_TIMEOUT_MS) {
      const out = this.sessionManager.getCleanTail(this.terminalId, 5);
      if (out.trim().length > 0 && out === last) {
        stable++;
        if (stable >= 2) return;
      } else {
        stable = 0;
      }
      last = out;
      await sleep(500);
    }
    throw new Error("Shell initialization timeout");
  }
}
