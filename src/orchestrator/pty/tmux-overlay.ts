/**
 * TmuxOverlay — optional visual overlay for macOS/Linux.
 *
 * When tmux is available, mirrors PTY output to tmux panes for
 * visual monitoring of worker agents. The orchestrator does NOT
 * depend on tmux — this is purely a debugging/observability aid.
 *
 * @see IMPLEMENT_PLAN.md Section 6.2
 */

import { execSync } from "node:child_process";

import type { PtySession } from "./session-manager.js";

/**
 * Manages an optional tmux session that mirrors PTY output for
 * visual monitoring. Each worker gets its own tmux window.
 *
 * Output is batched via a 100ms flush interval and delivered using
 * tmux load-buffer / paste-buffer to avoid send-keys escaping issues.
 */
export class TmuxOverlay {
  private readonly available: boolean;
  private sessionName: string | null = null;
  private readonly outputQueues = new Map<string, string>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Detect tmux availability (not supported on Windows)
    if (process.platform === "win32") {
      this.available = false;
    } else {
      try {
        execSync("tmux -V", { stdio: "ignore" });
        this.available = true;
      } catch {
        this.available = false;
      }
    }
  }

  /** Whether tmux is installed and available on this platform. */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Create a new tmux session for the orchestrator.
   *
   * Starts a detached tmux session with a 200x50 terminal and
   * begins the 100ms flush interval for output delivery.
   *
   * @param name Session name (e.g. "ac-supervisor").
   */
  createSession(name: string): void {
    if (!this.available) return;

    this.sessionName = name;

    try {
      execSync(`tmux new-session -d -s ${this.escapeArg(name)} -x 200 -y 50`, {
        stdio: "ignore",
      });
    } catch {
      // Session may already exist — ignore
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flushAll();
    }, 100);
  }

  /**
   * Add a worker pane to the tmux session.
   *
   * Creates a new tmux window for the worker and subscribes to the
   * PTY session's onData stream to queue output for delivery.
   *
   * @param _workerId  Worker terminal ID (unused, kept for API symmetry).
   * @param label      Window label (e.g. "developer-a1b2c3d4").
   * @param ptySession PTY session to mirror output from.
   */
  addWorkerPane(_workerId: string, label: string, ptySession: PtySession): void {
    if (!this.available || !this.sessionName) return;

    const safeLabel = this.sanitizeLabel(label);

    try {
      execSync(
        `tmux new-window -t ${this.escapeArg(this.sessionName)} -n ${this.escapeArg(safeLabel)}`,
        { stdio: "ignore" },
      );
    } catch {
      // Window creation failed — best effort
      return;
    }

    this.outputQueues.set(safeLabel, "");

    // Subscribe to PTY output and queue for batched delivery
    ptySession.pty.onData((data: string) => {
      const existing = this.outputQueues.get(safeLabel) ?? "";
      this.outputQueues.set(safeLabel, existing + data);
    });
  }

  /**
   * Destroy the tmux session and stop the flush interval.
   *
   * Safe to call multiple times or when no session exists.
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.sessionName) {
      try {
        execSync(`tmux kill-session -t ${this.escapeArg(this.sessionName)}`, {
          stdio: "ignore",
        });
      } catch {
        // Session may not exist — ignore
      }
      this.sessionName = null;
    }

    this.outputQueues.clear();
  }

  // ── Private ───────────────────────────────────────────────────────

  /**
   * Flush all queued output to tmux windows.
   *
   * Uses tmux load-buffer/paste-buffer instead of send-keys to avoid
   * escaping issues with special characters in terminal output.
   * Each window gets its own named buffer to prevent cross-contamination.
   */
  private flushAll(): void {
    if (!this.sessionName) return;

    for (const [label, data] of this.outputQueues) {
      if (data.length === 0) continue;

      // Clear the queue before attempting delivery
      this.outputQueues.set(label, "");

      // Create a unique buffer name (alphanumeric + hyphens only)
      const bufName = `ac-${label.replace(/[^a-z0-9-]/gi, "")}`;

      try {
        // Load data into a named tmux buffer
        execSync(`tmux load-buffer -b ${this.escapeArg(bufName)} -`, {
          input: data,
          stdio: ["pipe", "ignore", "ignore"],
        });

        // Paste the buffer into the target window
        execSync(
          `tmux paste-buffer -b ${this.escapeArg(bufName)} -t ${this.escapeArg(this.sessionName)}:${this.escapeArg(label)}`,
          { stdio: "ignore" },
        );

        // Clean up the named buffer
        execSync(`tmux delete-buffer -b ${this.escapeArg(bufName)}`, {
          stdio: "ignore",
        });
      } catch {
        // Best effort — tmux may have issues with specific panes
      }
    }
  }

  /**
   * Sanitize a label for use as a tmux window name.
   * Keeps only alphanumeric characters and hyphens.
   */
  private sanitizeLabel(label: string): string {
    return label.replace(/[^a-zA-Z0-9-]/g, "");
  }

  /**
   * Escape a string for safe use in shell commands.
   * Wraps in single quotes and escapes any embedded single quotes.
   */
  private escapeArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
