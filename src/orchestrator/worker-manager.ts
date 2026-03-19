/**
 * WorkerManager — manages spawning, tasking, and destroying worker agents.
 *
 * Coordinates between PtySessionManager (terminal lifecycle),
 * CliProviderManager (CLI tool adapters), and StateStore (persistence).
 * Each worker is a PTY session running a CLI tool (Claude Code, Codex, etc.)
 * that can receive tasks and produce responses.
 *
 * @see IMPLEMENT_PLAN.md Section 8.1
 */

import type { PtySessionManager } from "./pty/session-manager.js";
import type { CliProviderManager } from "./cli-providers/cli-provider-manager.js";
import type { ProfileLoader } from "./profiles/profile-loader.js";
import type { StateStore } from "./state-store.js";
import type {
  AgentProfile,
  CliProviderType,
  TerminalStatus,
  WorkerInfo,
} from "./constants.js";
import { MAX_WORKERS_PER_SESSION } from "./constants.js";
import { sleep } from "./utils/helpers.js";

// ── WorkerManager ─────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of worker agents. Workers are PTY sessions running
 * CLI-based AI tools. The manager handles:
 *
 * - Spawning workers with provider-specific initialization
 * - Sending tasks to workers
 * - Polling worker status
 * - Extracting responses
 * - Waiting for completion
 * - Graceful destruction with cleanup
 *
 * Enforces MAX_WORKERS_PER_SESSION to prevent resource exhaustion.
 */
export class WorkerManager {
  readonly state: StateStore;
  private readonly workerProfiles = new Map<string, AgentProfile>();
  private readonly initializedWorkers = new Set<string>();

  constructor(
    private readonly sessionManager: PtySessionManager,
    private readonly cliProviderManager: CliProviderManager,
    private readonly profileLoader: ProfileLoader,
    state: StateStore,
    readonly sessionId: string,
    readonly workingDirectory: string,
  ) {
    this.state = state;
  }

  // ── Spawn ───────────────────────────────────────────────────────────

  /**
   * Spawn a new worker agent.
   *
   * 1. Checks the worker limit (MAX_WORKERS_PER_SESSION)
   * 2. Creates a PTY session via PtySessionManager
   * 3. Creates and initializes a CLI provider adapter
   * 4. Persists the terminal record in StateStore
   *
   * @param opts Worker configuration: agent profile, CLI provider type, optional model.
   * @returns WorkerInfo with the terminal ID, provider, and initial status.
   * @throws {Error} If the maximum worker count is reached.
   */
  async spawnWorker(opts: {
    agentProfile: string;
    provider: CliProviderType;
    model?: string;
  }): Promise<WorkerInfo> {
    // Enforce worker limit
    const existing = this.state.listTerminals(this.sessionId);
    if (existing.length >= MAX_WORKERS_PER_SESSION) {
      throw new Error(
        `Maximum workers reached (${MAX_WORKERS_PER_SESSION}). ` +
        `Destroy existing workers before spawning new ones.`,
      );
    }

    const profile = this.profileLoader.load(opts.agentProfile);
    let terminalId: string | undefined;

    try {
      const session = this.sessionManager.spawn({
        provider: opts.provider,
        agentProfile: opts.agentProfile,
        workingDirectory: this.workingDirectory,
      });
      terminalId = session.id;

      const cliProvider = this.cliProviderManager.create(
        opts.provider,
        session.id,
        this.sessionManager,
        opts.model,
      );
      await cliProvider.initialize();

      this.workerProfiles.set(session.id, profile);

      this.state.createTerminal({
        id: session.id,
        sessionId: this.sessionId,
        pid: process.pid,
        provider: opts.provider,
        agentProfile: opts.agentProfile,
        status: "idle",
        createdAt: new Date(),
      });

      return {
        terminalId: session.id,
        provider: opts.provider,
        status: "idle" as const,
      };
    } catch (error: unknown) {
      if (terminalId !== undefined) {
        this.cliProviderManager.remove(terminalId);
        if (this.sessionManager.has(terminalId)) {
          this.sessionManager.destroy(terminalId);
        }
        this.state.deleteTerminal(terminalId);
        this.workerProfiles.delete(terminalId);
        this.initializedWorkers.delete(terminalId);
      }
      throw error;
    }
  }

  // ── Task Submission ─────────────────────────────────────────────────

  /**
   * Send a task message to a worker.
   *
   * Delegates to the CLI provider's sendTask() method which handles
   * the provider-specific input submission (e.g. multiple enter keys).
   * Updates the terminal status to "processing" in StateStore.
   *
   * @param tid     Terminal ID of the target worker.
   * @param message Task description/message to send.
   * @throws {Error} If no CLI provider is registered for this terminal.
   */
  async sendTask(tid: string, message: string): Promise<void> {
    const provider = this.cliProviderManager.get(tid);
    if (!provider) {
      throw new Error(`No CLI provider for terminal: ${tid}`);
    }

    const workerProfile = this.workerProfiles.get(tid);
    const payload =
      workerProfile !== undefined && !this.initializedWorkers.has(tid)
        ? `${workerProfile.systemPrompt}\n\n## Assigned Task\n${message}`
        : message;

    await provider.sendTask(payload);
    this.initializedWorkers.add(tid);
    this.state.updateTerminalStatus(tid, "processing");
  }

  // ── Status & Response ───────────────────────────────────────────────

  /**
   * Get the current status of a worker by reading its terminal output.
   *
   * Delegates to the CLI provider's getStatus() method which parses
   * terminal output to determine the current state.
   *
   * @param tid Terminal ID of the worker.
   * @returns Current terminal status, or "error" if the provider is missing.
   */
  getStatus(tid: string): TerminalStatus {
    const provider = this.cliProviderManager.get(tid);
    if (!provider) return "error";
    return provider.getStatus();
  }

  /**
   * Extract the last response from a worker's terminal output.
   *
   * Uses the CLI provider's extractWithRetry() method which handles
   * provider-specific response parsing with retry logic.
   *
   * @param tid Terminal ID of the worker.
   * @returns The extracted response text.
   * @throws {Error} If no CLI provider is registered for this terminal.
   */
  async extractResponse(tid: string): Promise<string> {
    const provider = this.cliProviderManager.get(tid);
    if (!provider) {
      throw new Error(`No CLI provider for terminal: ${tid}`);
    }
    return provider.extractWithRetry();
  }

  /**
   * Wait for a worker to reach the "completed" status.
   *
   * Polls the CLI provider's status at regular intervals until
   * the terminal shows "completed" or the timeout is reached.
   *
   * @param tid       Terminal ID of the worker.
   * @param timeoutMs Maximum time to wait in milliseconds.
   * @returns true if the worker completed, false on timeout or error.
   */
  async waitForCompletion(tid: string, timeoutMs: number): Promise<boolean> {
    const provider = this.cliProviderManager.get(tid);
    if (!provider) return false;
    return provider.waitUntilStatus(["completed"], timeoutMs);
  }

  // ── Destruction ─────────────────────────────────────────────────────

  /**
   * Destroy a single worker.
   *
   * 1. Sends the exit command via the CLI provider
   * 2. Waits 1 second for graceful shutdown
   * 3. Destroys the PTY session
   * 4. Removes the CLI provider adapter
   * 5. Deletes the terminal record from StateStore
   *
   * @param tid Terminal ID of the worker to destroy.
   */
  async destroyWorker(tid: string): Promise<void> {
    // Gracefully exit the CLI tool
    const provider = this.cliProviderManager.get(tid);
    if (provider) {
      try {
        provider.exit();
      } catch {
        // CLI tool may already be dead — ignore
      }
    }

    // Allow time for graceful shutdown
    await sleep(1_000);

    // Destroy PTY session (handles platform-specific cleanup)
    this.sessionManager.destroy(tid);

    // Remove CLI provider adapter
    this.cliProviderManager.remove(tid);
    this.workerProfiles.delete(tid);
    this.initializedWorkers.delete(tid);

    // Delete terminal record from persistence
    this.state.deleteTerminal(tid);
  }

  /**
   * Destroy all workers belonging to this session.
   *
   * Runs all destructions concurrently via Promise.allSettled to
   * ensure all workers are cleaned up even if some fail.
   */
  async destroyAll(): Promise<void> {
    const terminals = this.state.listTerminals(this.sessionId);
    await Promise.allSettled(
      terminals.map((t) => this.destroyWorker(t.id)),
    );
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /**
   * List all workers in this session with their current status.
   *
   * Reads terminal records from StateStore and enriches them with
   * live status from the CLI provider adapters.
   *
   * @returns Array of worker info objects.
   */
  listWorkers(): WorkerInfo[] {
    const terminals = this.state.listTerminals(this.sessionId);
    return terminals.map((t) => ({
      terminalId: t.id,
      provider: t.provider,
      status: this.getStatus(t.id),
    }));
  }
}
