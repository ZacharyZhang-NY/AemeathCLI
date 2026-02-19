/**
 * TmuxManager — Programmatic tmux control per PRD section 9.2.
 * Creates sessions, splits panes, sends commands, manages lifecycle.
 */

import { execa } from "execa";
import type { ILayoutConfig, IPaneConfig } from "../types/team.js";
import type { IComputedLayout, IPaneGeometry } from "./layout-engine.js";
import { LayoutEngine } from "./layout-engine.js";
import { getEventBus } from "../core/event-bus.js";
import { logger } from "../utils/logger.js";
import { AgentSpawnError } from "../types/errors.js";

// ── Types ───────────────────────────────────────────────────────────────

export interface ITmuxPaneInfo {
  readonly paneId: string;
  readonly tmuxPaneId: string;
  readonly agentName: string;
  readonly title: string;
}

interface ITmuxManagerOptions {
  readonly sessionPrefix?: string;
}

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_SESSION_PREFIX = "aemeathcli";
const TMUX_BINARY = "tmux";

// ── TmuxManager ─────────────────────────────────────────────────────────

export class TmuxManager {
  private readonly sessionPrefix: string;
  private readonly layoutEngine: LayoutEngine;
  private readonly panes = new Map<string, ITmuxPaneInfo>();
  private sessionName: string | undefined;
  private disposed = false;

  constructor(options?: ITmuxManagerOptions) {
    this.sessionPrefix = options?.sessionPrefix ?? DEFAULT_SESSION_PREFIX;
    this.layoutEngine = new LayoutEngine();
  }

  /**
   * Check if tmux is available on this system.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await execa("which", [TMUX_BINARY]);
      return result.exitCode === 0;
    } catch {
      logger.warn("tmux binary not found on PATH");
      return false;
    }
  }

  /**
   * Create a new tmux session for a team.
   */
  async createSession(teamName: string): Promise<string> {
    this.assertNotDisposed();

    if (!(await this.isAvailable())) {
      throw new AgentSpawnError(
        teamName,
        "tmux is not installed. Install tmux or use single-pane mode.",
      );
    }

    this.sessionName = `${this.sessionPrefix}-${teamName}`;

    // Kill any existing session with the same name
    await this.killSessionSilent(this.sessionName);

    try {
      await execa(TMUX_BINARY, [
        "new-session",
        "-d",
        "-s", this.sessionName,
        "-x", String(process.stdout.columns ?? 120),
        "-y", String(process.stdout.rows ?? 40),
      ]);
      logger.info({ sessionName: this.sessionName }, "tmux session created");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AgentSpawnError(teamName, `Failed to create tmux session: ${message}`);
    }

    return this.sessionName;
  }

  /**
   * Create split panes based on a layout configuration.
   */
  async createPanes(layoutConfig: ILayoutConfig): Promise<IComputedLayout> {
    this.assertNotDisposed();
    this.assertSession();

    const computed = this.layoutEngine.computeLayout(layoutConfig);

    // First pane is already the initial pane in the session
    const firstGeometry = computed.panes[0];
    const firstConfig = layoutConfig.panes[0];
    if (firstGeometry && firstConfig) {
      const tmuxPaneId = await this.getFirstPaneId();
      const info: ITmuxPaneInfo = {
        paneId: firstConfig.paneId,
        tmuxPaneId,
        agentName: firstConfig.agentName,
        title: firstConfig.title,
      };
      this.panes.set(firstConfig.paneId, info);
      await this.setPaneTitle(tmuxPaneId, firstConfig.title);
      getEventBus().emit("pane:created", {
        paneId: firstConfig.paneId,
        agentName: firstConfig.agentName,
      });
    }

    // Create remaining panes via splits
    for (let i = 1; i < computed.panes.length; i++) {
      const geometry = computed.panes[i];
      const config = layoutConfig.panes[i];
      if (!geometry || !config) continue;

      const tmuxPaneId = await this.splitPane(geometry);
      const info: ITmuxPaneInfo = {
        paneId: config.paneId,
        tmuxPaneId,
        agentName: config.agentName,
        title: config.title,
      };
      this.panes.set(config.paneId, info);
      await this.setPaneTitle(tmuxPaneId, config.title);
      getEventBus().emit("pane:created", {
        paneId: config.paneId,
        agentName: config.agentName,
      });
    }

    // Equalize layout after all splits
    await this.equalizeLayout();

    logger.info(
      { paneCount: this.panes.size, session: this.sessionName },
      "All panes created",
    );

    return computed;
  }

  /**
   * Send a command string to a specific pane.
   */
  async sendCommand(paneId: string, command: string): Promise<void> {
    this.assertNotDisposed();
    this.assertSession();

    const info = this.panes.get(paneId);
    if (!info) {
      logger.warn({ paneId }, "Pane not found, cannot send command");
      return;
    }

    await execa(TMUX_BINARY, [
      "send-keys",
      "-t", `${this.sessionName}:${info.tmuxPaneId}`,
      command,
      "Enter",
    ]);

    logger.debug({ paneId, command: command.slice(0, 80) }, "Command sent to pane");
  }

  /**
   * Resize a pane by tmux pane target.
   */
  async resizePane(
    paneId: string,
    dimensions: { width?: number; height?: number },
  ): Promise<void> {
    this.assertNotDisposed();
    this.assertSession();

    const info = this.panes.get(paneId);
    if (!info) return;

    const target = `${this.sessionName}:${info.tmuxPaneId}`;

    if (dimensions.width !== undefined) {
      await execa(TMUX_BINARY, ["resize-pane", "-t", target, "-x", String(dimensions.width)]);
    }
    if (dimensions.height !== undefined) {
      await execa(TMUX_BINARY, ["resize-pane", "-t", target, "-y", String(dimensions.height)]);
    }
  }

  /**
   * Set the title for a tmux pane.
   */
  private async setPaneTitle(tmuxPaneId: string, title: string): Promise<void> {
    if (!this.sessionName) return;
    try {
      await execa(TMUX_BINARY, [
        "select-pane",
        "-t", `${this.sessionName}:${tmuxPaneId}`,
        "-T", title,
      ]);
    } catch {
      logger.debug({ tmuxPaneId, title }, "Failed to set pane title (non-fatal)");
    }
  }

  /**
   * Kill a specific pane.
   */
  async killPane(paneId: string): Promise<void> {
    this.assertNotDisposed();

    const info = this.panes.get(paneId);
    if (!info || !this.sessionName) return;

    try {
      await execa(TMUX_BINARY, [
        "kill-pane",
        "-t", `${this.sessionName}:${info.tmuxPaneId}`,
      ]);
      this.panes.delete(paneId);
      getEventBus().emit("pane:closed", { paneId });
      logger.debug({ paneId }, "Pane killed");
    } catch {
      logger.debug({ paneId }, "Failed to kill pane (may already be closed)");
    }
  }

  /**
   * Attach to the tmux session (gives control to the user).
   */
  async attachSession(): Promise<void> {
    this.assertNotDisposed();
    this.assertSession();

    await execa(TMUX_BINARY, ["attach-session", "-t", this.sessionName!], {
      stdio: "inherit",
    });
  }

  /**
   * Check if the session still exists.
   */
  async isSessionAlive(): Promise<boolean> {
    if (!this.sessionName) return false;
    try {
      await execa(TMUX_BINARY, ["has-session", "-t", this.sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destroy the entire tmux session and all panes.
   */
  async destroy(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    if (this.sessionName) {
      await this.killSessionSilent(this.sessionName);

      for (const paneId of this.panes.keys()) {
        getEventBus().emit("pane:closed", { paneId });
      }
      this.panes.clear();

      logger.info({ sessionName: this.sessionName }, "tmux session destroyed");
      this.sessionName = undefined;
    }
  }

  /**
   * Get the current session name.
   */
  getSessionName(): string | undefined {
    return this.sessionName;
  }

  /**
   * Get all tracked pane info.
   */
  getPanes(): ReadonlyMap<string, ITmuxPaneInfo> {
    return this.panes;
  }

  // ── Private Helpers ─────────────────────────────────────────────────

  private async splitPane(geometry: IPaneGeometry): Promise<string> {
    const splitFlag = geometry.splitDirection === "horizontal" ? "-h" : "-v";

    const result = await execa(TMUX_BINARY, [
      "split-window",
      splitFlag,
      "-t", this.sessionName!,
      "-P",
      "-F", "#{pane_id}",
    ]);

    const tmuxPaneId = result.stdout.trim();
    logger.debug(
      { tmuxPaneId, direction: geometry.splitDirection },
      "Pane split created",
    );
    return tmuxPaneId;
  }

  private async getFirstPaneId(): Promise<string> {
    const result = await execa(TMUX_BINARY, [
      "list-panes",
      "-t", this.sessionName!,
      "-F", "#{pane_id}",
    ]);
    const firstLine = result.stdout.trim().split("\n")[0];
    return firstLine ?? "%0";
  }

  private async equalizeLayout(): Promise<void> {
    if (!this.sessionName) return;
    try {
      await execa(TMUX_BINARY, [
        "select-layout",
        "-t", this.sessionName,
        "tiled",
      ]);
    } catch {
      logger.debug("Failed to equalize layout (non-fatal)");
    }
  }

  private async killSessionSilent(sessionName: string): Promise<void> {
    try {
      await execa(TMUX_BINARY, ["kill-session", "-t", sessionName]);
    } catch {
      // Session may not exist — ignore
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new AgentSpawnError("tmux", "TmuxManager has been disposed");
    }
  }

  private assertSession(): void {
    if (!this.sessionName) {
      throw new AgentSpawnError("tmux", "No active tmux session. Call createSession() first.");
    }
  }
}
