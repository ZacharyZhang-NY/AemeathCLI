/**
 * `ac launch` — Start an orchestrator session with AI agent workers.
 *
 * Supports two modes:
 *   - **Single-shot**: `ac launch --task "Fix the failing tests"` — runs to completion
 *   - **REPL** (default): Interactive supervisor loop
 *
 * @see IMPLEMENT_PLAN.md Section 10
 */

import { Command } from "commander";
import pc from "picocolors";
import { CLI_PROVIDERS, type CliProviderType } from "../../orchestrator/constants.js";
import type { PermissionMode } from "../../types/tool.js";

const VALID_PERMISSION_MODES: readonly PermissionMode[] = [
  "strict",
  "standard",
  "permissive",
] as const;

function isPermissionMode(value: string): value is PermissionMode {
  return (VALID_PERMISSION_MODES as readonly string[]).includes(value);
}

function isCliProviderType(value: string): value is CliProviderType {
  return (CLI_PROVIDERS as readonly string[]).includes(value);
}

export function createLaunchCommand(): Command {
  return new Command("launch")
    .description("Launch an orchestrator session with AI agent workers")
    .option("--profile <name>", "Supervisor agent profile (default: supervisor)", "supervisor")
    .option("--agents <profile>", "Deprecated alias for --profile")
    .option("--worker-provider <provider>", "Default CLI provider for workers", "claude-code")
    .option("--supervisor-model <model>", "Override supervisor model")
    .option("--permission-mode <mode>", "Permission mode for built-in tools", "standard")
    .option("--project-root <path>", "Project root for built-in tools")
    .option("--visual", "Enable tmux visual overlay (macOS/Linux)")
    .option("--task <message>", "Single-shot task (exits after completion)")
    .option("--repl", "Start interactive REPL mode (default when no --task)")
    .action(async (options: {
      profile?: string;
      agents?: string;
      workerProvider: string;
      supervisorModel?: string;
      permissionMode: string;
      projectRoot?: string;
      visual?: boolean;
      task?: string;
      repl?: boolean;
    }) => {
      try {
        if (!options.task && (!process.stdin.isTTY || !process.stdout.isTTY)) {
          process.stderr.write(
            pc.red("REPL mode requires a TTY. Use `aemeathcli launch --task \"...\"` in automation.\n"),
          );
          process.exitCode = 2;
          return;
        }

        if (!isPermissionMode(options.permissionMode)) {
          process.stderr.write(
            pc.red(
              `Invalid permission mode "${options.permissionMode}". Valid values: ${VALID_PERMISSION_MODES.join(", ")}.\n`,
            ),
          );
          process.exitCode = 2;
          return;
        }

        if (!isCliProviderType(options.workerProvider)) {
          process.stderr.write(
            pc.red(
              `Invalid worker provider "${options.workerProvider}". Valid values: ${CLI_PROVIDERS.join(", ")}.\n`,
            ),
          );
          process.exitCode = 2;
          return;
        }

        // Lazy imports for fast CLI startup
        const { OrchestratorEngine } = await import("../../orchestrator/engine.js");
        const { PtySessionManager } = await import("../../orchestrator/pty/session-manager.js");
        const { CliProviderManager } = await import("../../orchestrator/cli-providers/cli-provider-manager.js");
        const { StateStore } = await import("../../orchestrator/state-store.js");
        const { ProfileLoader } = await import("../../orchestrator/profiles/profile-loader.js");
        const { createDefaultRegistry } = await import("../../providers/registry.js");
        const { createModelRouter } = await import("../../core/model-router.js");
        const { CostTracker } = await import("../../core/cost-tracker.js");
        const { getEventBus } = await import("../../core/event-bus.js");
        const { createDefaultRegistry: createToolRegistry } = await import("../../tools/index.js");
        const { ConfigStore } = await import("../../storage/config-store.js");
        const { randomUUID } = await import("node:crypto");
        const pathModule = await import("node:path");
        const { detectInstalledProviders } = await import("../../orchestrator/utils/detect-providers.js");
        const { hasGlobalConfig, runFirstRunSetup } = await import("../setup/first-run.js");

        // Detect available providers
        const installedProviders = detectInstalledProviders();
        const supervisorProfile = options.agents !== undefined ? options.agents : options.profile;
        const workerProvider = options.workerProvider;

        if (!hasGlobalConfig()) {
          await runFirstRunSetup();
        }

        process.stdout.write(`${pc.bold("AemeathCLI Orchestrator")}\n`);
        process.stdout.write(
          `${pc.dim(`Profile: ${supervisorProfile} | Worker Provider: ${workerProvider}`)}\n`,
        );
        if (installedProviders.length > 0) {
          process.stdout.write(`${pc.dim(`Detected CLIs: ${installedProviders.join(", ")}`)}\n`);
        }
        process.stdout.write("\n");

        // Initialize dependencies
        const configStore = new ConfigStore();
        const config = configStore.loadGlobal();
        const providerRegistry = await createDefaultRegistry({ preferSdk: true });
        const modelRouter = createModelRouter(config);
        if (options.supervisorModel) {
          modelRouter.setUserOverride(options.supervisorModel);
        }
        const costTracker = new CostTracker(config.cost);
        const eventBus = getEventBus();
        const sessionManager = new PtySessionManager();
        const cliProviderManager = new CliProviderManager();
        const profileLoader = new ProfileLoader();
        const projectRoot = pathModule.resolve(options.projectRoot ?? process.cwd());
        const allowedPaths = Array.from(
          new Set(
            [projectRoot, ...config.permissions.allowedPaths]
              .map((allowedPath) =>
                pathModule.isAbsolute(allowedPath)
                  ? allowedPath
                  : pathModule.resolve(projectRoot, allowedPath),
              ),
          ),
        );
        const permissionMode = options.permissionMode;

        // Build tool registry with built-in tools
        const toolContext = {
          projectRoot,
          workingDirectory: projectRoot,
          permissionMode,
          allowedPaths,
          blockedCommands: [...config.permissions.blockedCommands],
        };
        const toolRegistry = createToolRegistry(toolContext);

        const supervisorResolution = modelRouter.resolve("planning");

        const state = new StateStore();
        const sessionId = randomUUID();

        const engine = new OrchestratorEngine({
          sessionManager,
          cliProviderManager,
          state,
          providerRegistry,
          modelRouter,
          toolRegistry,
          toolContext,
          costTracker,
          profileLoader,
          config,
          eventBus,
          sessionId,
          workingDirectory: projectRoot,
        });

        engine.setupSignalHandlers();

        if (options.task) {
          // Single-shot mode
          process.stdout.write(`${pc.dim("Running single-shot task...")}\n\n`);
          const result = await engine.run(options.task, {
            supervisorProfile,
            supervisorModel: options.supervisorModel,
            defaultWorkerProvider: workerProvider,
            visual: options.visual,
          });
          process.stdout.write("\n");
          process.stdout.write(
            `${pc.dim(`Completed in ${result.steps} steps | Cost: $${result.totalCost.toFixed(4)}`)}\n`,
          );
        } else {
          // REPL mode
          await engine.repl({
            supervisorProfile,
            supervisorModel: options.supervisorModel,
            defaultWorkerProvider: workerProvider,
            visual: options.visual,
          });
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Launch failed: ${msg}\n`));
        process.exitCode = 1;
      }
    });
}
