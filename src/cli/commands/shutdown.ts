/**
 * `ac shutdown` — Shutdown orchestrator sessions.
 *
 * Destroys PTY sessions and cleans up state database records.
 * Supports shutting down a specific session by ID or performing
 * a general cleanup of stale records.
 *
 * @see IMPLEMENT_PLAN.md Section 10
 */

import { Command } from "commander";
import pc from "picocolors";

export function createShutdownCommand(): Command {
  return new Command("shutdown")
    .description("Shutdown orchestrator sessions")
    .option("--all", "Shutdown all sessions")
    .option("--session <id>", "Shutdown a specific session")
    .option("--json", "Output machine-readable JSON")
    .action(async (options: { all?: boolean; session?: string; json?: boolean }) => {
      try {
        const { StateStore } = await import("../../orchestrator/state-store.js");
        const state = new StateStore();
        const terminatePid = (pid: number): boolean => {
          if (pid === process.pid) {
            return false;
          }

          try {
            process.kill(pid, "SIGTERM");
            return true;
          } catch {
            return false;
          }
        };

        try {
          if (!options.all && !options.session) {
            process.stderr.write(pc.red("Specify --session <id> or --all.\n"));
            process.exitCode = 2;
            return;
          }

          if (options.session) {
            const session = state.listSessions().find((entry) => entry.sessionId === options.session);
            if (!session) {
              process.stderr.write(pc.red(`Session not found: ${options.session}\n`));
              process.exitCode = 1;
              return;
            }

            const signalled = session.pid !== undefined ? terminatePid(session.pid) : false;
            state.deleteSession(session.sessionId);
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({ mode: "session", sessionId: session.sessionId, signalled }, null, 2)}\n`,
              );
              return;
            }
            process.stdout.write(
              pc.green(
                `Session ${session.sessionId} shutdown ${signalled ? "(signal sent)" : "(stale state cleaned)"}.\n`,
              ),
            );
            return;
          }

          const sessions = state.listSessions();
          const signalledPids = new Set<number>();
          for (const session of sessions) {
            if (session.pid !== undefined && terminatePid(session.pid)) {
              signalledPids.add(session.pid);
            }
          }

          const deletedSessions = state.deleteAllSessions();
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                mode: "all",
                deletedSessions,
                signalledProcesses: [...signalledPids],
              }, null, 2)}\n`,
            );
            return;
          }
          process.stdout.write(
            pc.green(
              `Shutdown complete. Cleaned ${deletedSessions.length} session(s), signalled ${signalledPids.size} process(es).\n`,
            ),
          );
        } finally {
          state.close();
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Shutdown failed: ${msg}\n`));
        process.exitCode = 1;
      }
    });
}
