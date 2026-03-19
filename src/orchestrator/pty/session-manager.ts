/**
 * PtySessionManager — cross-platform terminal session management via node-pty.
 *
 * Manages PTY process lifecycle, buffered output capture, echo filtering,
 * and clean ANSI-stripped text extraction. Works on macOS (Unix PTY),
 * Linux (Unix PTY), and Windows (ConPTY).
 *
 * @see IMPLEMENT_PLAN.md Section 6.1
 */

import * as pty from "node-pty";
import { stripVTControlCharacters } from "node:util";

import type { CliProviderType, SpawnOptions } from "../constants.js";
import {
  MAX_BUFFER_BYTES,
  TAIL_BUFFER_LINES,
  EXIT_DRAIN_DELAY_MS,
  WINDOWS_KILL_TIMEOUT_MS,
} from "../constants.js";
import { generateId, sleep } from "../utils/helpers.js";

// ── PtySession ──────────────────────────────────────────────────────────

/**
 * Internal state for a single PTY session. Not exported — consumers
 * interact via PtySessionManager methods.
 */
export interface PtySession {
  /** Unique session identifier (8 hex chars). */
  readonly id: string;
  /** Underlying node-pty process. */
  readonly pty: pty.IPty;
  /** Raw cumulative output buffer (capped at MAX_BUFFER_BYTES). */
  buffer: string;
  /** Rolling window of the most recent complete lines. */
  tailLines: string[];
  /** Partial line awaiting a newline delimiter. */
  incompleteLine: string;
  /** CLI provider type that owns this session. */
  readonly provider: CliProviderType;
  /** Agent profile name (e.g. "developer", "reviewer"). */
  readonly agentProfile: string;
  /** Whether the PTY process is still alive. */
  alive: boolean;
  /** Recent non-trivial writes for echo filtering (max 10 entries). */
  recentWrites: string[];
  /** When this session was created. */
  readonly createdAt: Date;
  /** Event listener disposables for cleanup. */
  readonly disposables: pty.IDisposable[];
}

// ── PtySessionManager ───────────────────────────────────────────────────

/**
 * Manages multiple PTY sessions. Handles spawning, input, buffered output,
 * and cross-platform cleanup.
 */
export class PtySessionManager {
  private readonly sessions = new Map<string, PtySession>();

  // ── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Spawn a new PTY session.
   *
   * Creates a pseudo-terminal running the platform shell, wires up
   * output buffering (5MB cap, line splitting with \r\n normalization),
   * and registers an onExit handler with a 200ms drain delay to guard
   * against the Linux onExit-before-onData race.
   */
  spawn(opts: SpawnOptions): PtySession {
    const id = generateId();

    const ptyProcess = pty.spawn(this.getShell(), this.getShellArgs(), {
      name: process.platform === "win32" ? "cygwin" : "xterm-256color",
      cols: 200,
      rows: 50,
      cwd: opts.workingDirectory ?? process.cwd(),
      env: this.buildEnv(id),
    });

    const session: PtySession = {
      id,
      pty: ptyProcess,
      buffer: "",
      tailLines: [],
      incompleteLine: "",
      provider: opts.provider,
      agentProfile: opts.agentProfile ?? "unknown",
      alive: true,
      recentWrites: [],
      createdAt: new Date(),
      disposables: [],
    };

    // ── Stream output into capped buffer with proper line splitting ──
    const dataDisp = ptyProcess.onData((data: string) => {
      // Append to raw buffer and cap at MAX_BUFFER_BYTES
      session.buffer += data;
      if (session.buffer.length > MAX_BUFFER_BYTES) {
        session.buffer = session.buffer.slice(-MAX_BUFFER_BYTES);
      }

      // Normalize line endings and split into complete lines
      const normalized = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const combined = session.incompleteLine + normalized;
      const parts = combined.split("\n");

      // Last element is either empty (if data ended with \n) or a partial line
      session.incompleteLine = parts.pop() ?? "";

      if (parts.length > 0) {
        session.tailLines.push(...parts);
        if (session.tailLines.length > TAIL_BUFFER_LINES) {
          session.tailLines = session.tailLines.slice(-TAIL_BUFFER_LINES);
        }
      }
    });
    session.disposables.push(dataDisp);

    // ── Handle exit with drain delay ────────────────────────────────
    // On Linux, onExit can fire before the final onData chunks arrive.
    // The 200ms delay ensures we capture all output before marking dead.
    const exitDisp = ptyProcess.onExit(() => {
      setTimeout(() => {
        session.alive = false;
      }, EXIT_DRAIN_DELAY_MS);
    });
    session.disposables.push(exitDisp);

    this.sessions.set(id, session);
    return session;
  }

  /**
   * Destroy a single PTY session.
   *
   * On Windows, sends a carriage return before killing (ConPTY quirk)
   * and schedules a force-kill fallback after WINDOWS_KILL_TIMEOUT_MS.
   */
  destroy(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    // Windows ConPTY: send \r before kill to flush pending input
    if (process.platform === "win32") {
      try {
        session.pty.write("\r");
      } catch {
        // PTY may already be dead — ignore
      }
    }

    // Dispose event listeners first
    for (const d of session.disposables) {
      d.dispose();
    }

    // Kill the PTY process
    try {
      session.pty.kill();
    } catch {
      // Already dead — ignore
    }

    // Windows: schedule force-kill fallback
    if (process.platform === "win32" && session.pty.pid) {
      const pid = session.pty.pid;
      setTimeout(() => {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Process already gone — ignore
        }
      }, WINDOWS_KILL_TIMEOUT_MS);
    }

    this.sessions.delete(id);
  }

  /** Destroy all active PTY sessions. */
  destroyAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.destroy(id);
    }
  }

  // ── Input ─────────────────────────────────────────────────────────

  /**
   * Write raw data to a PTY session.
   *
   * Tracks non-trivial writes (trimmed, non-empty after stripping \r)
   * in a rolling buffer for echo filtering. Keeps the last 10 writes.
   */
  write(id: string, data: string): void {
    const session = this.getSession(id);

    // Track non-trivial writes for echo filtering
    const trimmed = data.replace(/\r$/g, "").trim();
    if (trimmed.length > 0) {
      session.recentWrites.push(trimmed);
      if (session.recentWrites.length > 10) {
        session.recentWrites.shift();
      }
    }

    session.pty.write(data);
  }

  /** Write text followed by a carriage return. */
  writeLine(id: string, text: string): void {
    this.write(id, text + "\r");
  }

  /**
   * Write text followed by multiple enter keystrokes with delays.
   *
   * Some CLI tools (e.g. Claude Code, Codex) require multiple enters
   * to submit input. The 300ms delays between enters prevent input
   * buffering issues.
   *
   * Note: The extra \r keystrokes are written directly to avoid
   * polluting recentWrites with bare carriage returns.
   */
  async writeWithEnters(id: string, text: string, enterCount: number): Promise<void> {
    this.write(id, text);
    const session = this.getSession(id);
    for (let i = 0; i < enterCount; i++) {
      if (i > 0) {
        await sleep(300);
      }
      session.pty.write("\r");
    }
  }

  // ── Output ────────────────────────────────────────────────────────

  /**
   * Get the most recent tail lines as clean text (ANSI control
   * characters stripped).
   *
   * @param id        Session identifier.
   * @param lineCount Number of tail lines to return. Defaults to
   *                  TAIL_BUFFER_LINES (200).
   */
  getCleanTail(id: string, lineCount?: number): string {
    const session = this.getSession(id);
    const count = lineCount ?? TAIL_BUFFER_LINES;
    const lines = session.tailLines.slice(-count);
    if (session.incompleteLine.length > 0) {
      lines.push(session.incompleteLine);
    }
    return stripVTControlCharacters(lines.join("\n"));
  }

  /**
   * Get full output with ANSI stripped and echo lines removed.
   *
   * Echo filtering works by removing lines whose trimmed content
   * exactly matches any entry in recentWrites. This handles the
   * common case where the PTY echoes back typed input.
   */
  getFilteredOutput(id: string): string {
    const session = this.getSession(id);
    const clean = stripVTControlCharacters(session.buffer);

    if (session.recentWrites.length === 0) return clean;

    // Build a set of recent writes for O(1) lookup
    const echoSet = new Set(session.recentWrites);

    return clean
      .split("\n")
      .filter((line) => !echoSet.has(line.trim()))
      .join("\n");
  }

  /**
   * Clear all output buffers for a session.
   *
   * Resets the raw buffer, tail lines, and incomplete line accumulator.
   * Does not affect recentWrites (needed for ongoing echo filtering).
   */
  clearBuffer(id: string): void {
    const session = this.getSession(id);
    session.buffer = "";
    session.tailLines = [];
    session.incompleteLine = "";
  }

  // ── Queries ───────────────────────────────────────────────────────

  /** List all active PTY sessions. */
  list(): PtySession[] {
    return [...this.sessions.values()];
  }

  /**
   * Get a session by ID.
   *
   * @throws {Error} If no session exists with the given ID.
   */
  getSession(id: string): PtySession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`PTY session not found: ${id}`);
    }
    return session;
  }

  /**
   * Check whether a session exists.
   */
  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /**
   * Get the number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  // ── Private Helpers ───────────────────────────────────────────────

  /**
   * Build the environment variables for a PTY session.
   *
   * - Injects AC_TERMINAL_ID for downstream identification.
   * - On Windows: preserves SystemRoot, unsets TERM (avoids Git Bash issues).
   * - On Unix: sets TERM=xterm-256color for proper terminal emulation.
   */
  private buildEnv(id: string): Record<string, string> {
    const baseEnv: Record<string, string> = {};

    // Copy process.env, filtering out undefined values
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        baseEnv[key] = value;
      }
    }

    // Inject terminal ID
    baseEnv["AC_TERMINAL_ID"] = id;

    if (process.platform === "win32") {
      // Windows: preserve SystemRoot, remove TERM
      if (process.env["SystemRoot"]) {
        baseEnv["SystemRoot"] = process.env["SystemRoot"];
      }
      delete baseEnv["TERM"];
    } else {
      // Unix: set TERM for proper terminal emulation
      baseEnv["TERM"] = "xterm-256color";
    }

    return baseEnv;
  }

  /**
   * Get the platform-appropriate shell executable.
   *
   * - Windows: %COMSPEC% or cmd.exe
   * - macOS/Linux: $SHELL or /bin/bash
   */
  private getShell(): string {
    if (process.platform === "win32") {
      return process.env["COMSPEC"] ?? "cmd.exe";
    }
    return process.env["SHELL"] ?? "/bin/bash";
  }

  /**
   * Get shell arguments.
   *
   * - Windows: no arguments (cmd.exe)
   * - Unix: -l (login shell, loads profile)
   */
  private getShellArgs(): string[] {
    if (process.platform === "win32") {
      return [];
    }
    return ["-l"];
  }
}
