/**
 * `ac info` — Show orchestrator system information.
 *
 * Displays detected CLI providers, available agent profiles,
 * and platform details. Sub-flags allow focusing on a specific
 * category (--providers, --profiles).
 *
 * @see IMPLEMENT_PLAN.md Section 10
 */

import { Command } from "commander";
import pc from "picocolors";

export function createInfoCommand(): Command {
  return new Command("info")
    .description("Show orchestrator system information")
    .option("--providers", "List detected CLI providers")
    .option("--profiles", "List available agent profiles")
    .option("--sessions", "List tracked orchestrator sessions")
    .option("--workers", "List tracked workers across all sessions")
    .option("--json", "Output machine-readable JSON")
    .action(async (options: {
      providers?: boolean;
      profiles?: boolean;
      sessions?: boolean;
      workers?: boolean;
      json?: boolean;
    }) => {
      try {
        const showSpecific =
          options.providers === true ||
          options.profiles === true ||
          options.sessions === true ||
          options.workers === true;

        if (options.json) {
          const payload: Record<string, unknown> = {};
          const includeAll = !showSpecific;

          if (options.providers || includeAll) {
            const { detectInstalledProviders } = await import("../../orchestrator/utils/detect-providers.js");
            payload["providers"] = detectInstalledProviders();
          }

          if (options.profiles || includeAll) {
            const { ProfileLoader } = await import("../../orchestrator/profiles/profile-loader.js");
            const loader = new ProfileLoader();
            payload["profiles"] = loader.listProfiles();
          }

          if (options.sessions || options.workers || includeAll) {
            const { StateStore } = await import("../../orchestrator/state-store.js");
            const state = new StateStore();
            try {
              if (options.sessions || includeAll) {
                payload["sessions"] = state.listSessions();
              }
              if (options.workers || includeAll) {
                payload["workers"] = state.listAllTerminals();
              }
            } finally {
              state.close();
            }
          }

          if (includeAll) {
            payload["platform"] = process.platform;
            payload["arch"] = process.arch;
            payload["nodeVersion"] = process.version;
          }

          process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
          return;
        }

        if (options.providers) {
          const { detectInstalledProviders } = await import("../../orchestrator/utils/detect-providers.js");
          const providers = detectInstalledProviders();
          process.stdout.write(`${pc.bold("Detected CLI Providers:")}\n`);
          if (providers.length === 0) {
            process.stdout.write(
              `${pc.yellow("  No CLI providers detected. Install claude, codex, gemini, kimi, or ollama.")}\n`,
            );
          } else {
            for (const p of providers) {
              process.stdout.write(`${pc.green(`  * ${p}`)}\n`);
            }
          }
          if (showSpecific) {
            process.stdout.write("\n");
          }
        }

        if (options.profiles) {
          const { ProfileLoader } = await import("../../orchestrator/profiles/profile-loader.js");
          const loader = new ProfileLoader();
          const profiles = loader.listProfiles();
          process.stdout.write(`${pc.bold("Available Agent Profiles:")}\n`);
          for (const profile of profiles) {
            const providerTag = profile.provider ? pc.dim(` [${profile.provider}]`) : "";
            process.stdout.write(`  ${pc.cyan(profile.name)}${providerTag} -- ${profile.description}\n`);
          }
          if (showSpecific) {
            process.stdout.write("\n");
          }
        }

        if (options.sessions) {
          const { StateStore } = await import("../../orchestrator/state-store.js");
          const state = new StateStore();
          try {
            const sessions = state.listSessions();
            process.stdout.write(`${pc.bold("Tracked Sessions:")}\n`);
            if (sessions.length === 0) {
              process.stdout.write(`  ${pc.yellow("No tracked sessions.")}\n`);
            } else {
              for (const session of sessions) {
                const pid = session.pid !== undefined ? ` pid=${session.pid}` : "";
                process.stdout.write(
                  `  ${pc.cyan(session.sessionId)}${pid} workers=${session.workerCount} providers=${session.providers.join(", ")}\n`,
                );
              }
            }
          } finally {
            state.close();
          }
          if (showSpecific) {
            process.stdout.write("\n");
          }
        }

        if (options.workers) {
          const { StateStore } = await import("../../orchestrator/state-store.js");
          const state = new StateStore();
          try {
            const workers = state.listAllTerminals();
            process.stdout.write(`${pc.bold("Tracked Workers:")}\n`);
            if (workers.length === 0) {
              process.stdout.write(`  ${pc.yellow("No tracked workers.")}\n`);
            } else {
              for (const worker of workers) {
                process.stdout.write(
                  `  ${pc.cyan(worker.id)} session=${worker.sessionId} provider=${worker.provider} profile=${worker.agentProfile ?? "unknown"}\n`,
                );
              }
            }
          } finally {
            state.close();
          }
          if (showSpecific) {
            process.stdout.write("\n");
          }
        }

        if (showSpecific) {
          return;
        }

        const { detectInstalledProviders } = await import("../../orchestrator/utils/detect-providers.js");
        const { ProfileLoader } = await import("../../orchestrator/profiles/profile-loader.js");
        const { StateStore } = await import("../../orchestrator/state-store.js");

        const providers = detectInstalledProviders();
        const loader = new ProfileLoader();
        const profiles = loader.listProfiles();
        const state = new StateStore();
        try {
          const sessions = state.listSessions();
          const workers = state.listAllTerminals();

          process.stdout.write(`${pc.bold("AemeathCLI Orchestrator")}\n\n`);
          process.stdout.write(
            `  CLI Providers: ${providers.length > 0 ? providers.map((provider) => pc.green(provider)).join(", ") : pc.yellow("none")}\n`,
          );
          process.stdout.write(`  Agent Profiles: ${profiles.map((profile) => pc.cyan(profile.name)).join(", ")}\n`);
          process.stdout.write(`  Sessions: ${sessions.length}\n`);
          process.stdout.write(`  Workers: ${workers.length}\n`);
          process.stdout.write(`  Platform: ${process.platform} (${process.arch})\n`);
          process.stdout.write(`  Node.js: ${process.version}\n`);
        } finally {
          state.close();
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Info failed: ${msg}\n`));
        process.exitCode = 1;
      }
    });
}
