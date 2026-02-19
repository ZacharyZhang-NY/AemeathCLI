/**
 * iTerm2Manager — macOS iTerm2 Python API bridge per PRD section 9.3.
 * Splits sessions into panes, sets profiles, sends commands.
 * Graceful fallback if iTerm2 is not available.
 */

import { execa } from "execa";
import type { ILayoutConfig, IPaneConfig, PaneLayout } from "../types/team.js";
import { getEventBus } from "../core/event-bus.js";
import { logger } from "../utils/logger.js";
import { AgentSpawnError } from "../types/errors.js";

// ── Types ───────────────────────────────────────────────────────────────

export interface IITerm2PaneInfo {
  readonly paneId: string;
  readonly sessionId: string;
  readonly agentName: string;
  readonly title: string;
}

interface IRoleProfile {
  readonly backgroundColor: string;
  readonly badgeText: string;
}

// ── Role color profiles per agent role ──────────────────────────────────

const ROLE_PROFILES: Readonly<Record<string, IRoleProfile>> = {
  planning: { backgroundColor: "#1a1a2e", badgeText: "Planner" },
  coding: { backgroundColor: "#162447", badgeText: "Coder" },
  review: { backgroundColor: "#1b2a1b", badgeText: "Reviewer" },
  testing: { backgroundColor: "#2a1b1b", badgeText: "Tester" },
  bugfix: { backgroundColor: "#2a2a1b", badgeText: "Debugger" },
  documentation: { backgroundColor: "#1b1b2a", badgeText: "Docs" },
};

const DEFAULT_PROFILE: IRoleProfile = {
  backgroundColor: "#1e1e1e",
  badgeText: "Agent",
};

// ── iTerm2 Manager ──────────────────────────────────────────────────────

export class ITerm2Manager {
  private readonly panes = new Map<string, IITerm2PaneInfo>();
  private disposed = false;

  /**
   * Check if currently running inside iTerm2 on macOS.
   */
  isAvailable(): boolean {
    if (process.platform !== "darwin") {
      logger.debug("iTerm2 manager is macOS-only");
      return false;
    }

    const termProgram = process.env["TERM_PROGRAM"];
    if (termProgram !== "iTerm.app") {
      logger.debug({ termProgram }, "Not running inside iTerm2");
      return false;
    }

    return true;
  }

  /**
   * Check if the iTerm2 Python API is accessible.
   */
  async isPythonAPIAvailable(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    try {
      const result = await execa("python3", ["-c", "import iterm2"]);
      return result.exitCode === 0;
    } catch {
      logger.warn("iTerm2 Python API module (iterm2) not installed");
      return false;
    }
  }

  /**
   * Create panes in the current iTerm2 window based on layout config.
   */
  async createPanes(layoutConfig: ILayoutConfig): Promise<void> {
    this.assertNotDisposed();

    if (!(await this.isPythonAPIAvailable())) {
      throw new AgentSpawnError(
        "iterm2",
        "iTerm2 Python API is not available. Install with: pip3 install iterm2",
      );
    }

    const script = this.buildCreatePanesScript(layoutConfig);

    try {
      await this.executePythonScript(script);
      logger.info(
        { paneCount: layoutConfig.panes.length },
        "iTerm2 panes created",
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AgentSpawnError("iterm2", `Failed to create iTerm2 panes: ${message}`);
    }
  }

  /**
   * Send a command to a specific pane via iTerm2 Python API.
   */
  async sendCommand(paneId: string, command: string): Promise<void> {
    this.assertNotDisposed();

    const info = this.panes.get(paneId);
    if (!info) {
      logger.warn({ paneId }, "iTerm2 pane not found, cannot send command");
      return;
    }

    const escapedCommand = command.replace(/"/g, '\\"').replace(/\\/g, "\\\\");
    const script = this.buildSendCommandScript(info.sessionId, escapedCommand);

    try {
      await this.executePythonScript(script);
      logger.debug({ paneId, command: command.slice(0, 80) }, "Command sent to iTerm2 pane");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ paneId, error: message }, "Failed to send command to iTerm2 pane");
    }
  }

  /**
   * Set the profile (colors) for a pane based on agent role.
   */
  async setProfile(paneId: string, role: string): Promise<void> {
    this.assertNotDisposed();

    const info = this.panes.get(paneId);
    if (!info) return;

    const profile = ROLE_PROFILES[role] ?? DEFAULT_PROFILE;
    const script = this.buildSetProfileScript(info.sessionId, profile);

    try {
      await this.executePythonScript(script);
      logger.debug({ paneId, role }, "iTerm2 pane profile set");
    } catch {
      logger.debug({ paneId, role }, "Failed to set iTerm2 profile (non-fatal)");
    }
  }

  /**
   * Destroy all managed iTerm2 panes.
   */
  async destroy(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    for (const [paneId, info] of this.panes) {
      try {
        const script = this.buildCloseSessionScript(info.sessionId);
        await this.executePythonScript(script);
      } catch {
        // Pane may already be closed
      }
      getEventBus().emit("pane:closed", { paneId });
    }

    this.panes.clear();
    logger.info("iTerm2 panes destroyed");
  }

  /**
   * Get all tracked pane info.
   */
  getPanes(): ReadonlyMap<string, IITerm2PaneInfo> {
    return this.panes;
  }

  /**
   * Register a pane that was created externally.
   */
  registerPane(info: IITerm2PaneInfo): void {
    this.panes.set(info.paneId, info);
    getEventBus().emit("pane:created", {
      paneId: info.paneId,
      agentName: info.agentName,
    });
  }

  // ── Python Script Builders ─────────────────────────────────────────

  private buildCreatePanesScript(layoutConfig: ILayoutConfig): string {
    const paneConfigs = layoutConfig.panes;
    const splitCommands = this.buildSplitCommands(paneConfigs, layoutConfig.layout);

    return `
import iterm2
import asyncio

async def main(connection):
    app = await iterm2.async_get_app(connection)
    window = app.current_terminal_window
    if window is None:
        return

    tab = window.current_tab
    root_session = tab.current_session
    sessions = [root_session]

${splitCommands}

    # Output session IDs for tracking
    for s in sessions:
        print(s.session_id)

iterm2.run_until_complete(main)
`.trim();
  }

  private buildSplitCommands(
    panes: readonly IPaneConfig[],
    layout: PaneLayout,
  ): string {
    const lines: string[] = [];

    for (let i = 1; i < panes.length; i++) {
      const vertical = this.shouldSplitVertically(i, panes.length, layout);
      const direction = vertical ? "True" : "False";
      lines.push(
        `    new_session = await sessions[${Math.floor(i / 2)}].async_split_pane(vertical=${direction})`,
      );
      lines.push(`    sessions.append(new_session)`);

      const pane = panes[i];
      if (pane) {
        const escapedTitle = pane.title.replace(/'/g, "\\'");
        lines.push(`    await new_session.async_set_name("${escapedTitle}")`);
      }
    }

    return lines.join("\n");
  }

  private shouldSplitVertically(
    index: number,
    total: number,
    layout: PaneLayout,
  ): boolean {
    if (layout === "vertical") return true;
    if (layout === "horizontal") return false;
    // Auto and grid: alternate directions
    if (total <= 2) return false;
    return index % 2 === 1;
  }

  private buildSendCommandScript(sessionId: string, command: string): string {
    return `
import iterm2

async def main(connection):
    app = await iterm2.async_get_app(connection)
    session = app.get_session_by_id("${sessionId}")
    if session:
        await session.async_send_text("${command}\\n")

iterm2.run_until_complete(main)
`.trim();
  }

  private buildSetProfileScript(sessionId: string, profile: IRoleProfile): string {
    return `
import iterm2

async def main(connection):
    app = await iterm2.async_get_app(connection)
    session = app.get_session_by_id("${sessionId}")
    if session:
        change = iterm2.LocalWriteOnlyProfile()
        color = iterm2.Color.from_hex("${profile.backgroundColor}")
        change.set_background_color(color)
        change.set_badge_text("${profile.badgeText}")
        await session.async_set_profile_properties(change)

iterm2.run_until_complete(main)
`.trim();
  }

  private buildCloseSessionScript(sessionId: string): string {
    return `
import iterm2

async def main(connection):
    app = await iterm2.async_get_app(connection)
    session = app.get_session_by_id("${sessionId}")
    if session:
        await session.async_close()

iterm2.run_until_complete(main)
`.trim();
  }

  // ── Execution ──────────────────────────────────────────────────────

  private async executePythonScript(script: string): Promise<string> {
    const result = await execa("python3", ["-c", script], {
      timeout: 10_000,
    });
    return result.stdout;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new AgentSpawnError("iterm2", "ITerm2Manager has been disposed");
    }
  }
}
