/**
 * Orchestration tools — registered as IToolRegistration objects into the
 * existing ToolRegistry, making them first-class citizens alongside
 * built-in tools (read, write, bash, grep, etc.).
 *
 * Five tools:
 * - handoff:          Sequential delegation (spawn → task → wait → extract → destroy)
 * - assign:           Parallel delegation (spawn → task → return terminal ID)
 * - collect_results:  Gather outputs from assigned workers
 * - send_message:     Message a running worker (immediate or queued)
 * - list_workers:     Show all active workers with status
 *
 * @see IMPLEMENT_PLAN.md Section 8.2
 */

import type { IToolRegistration, IToolResult, ToolCategory } from "../../types/index.js";
import type { IToolDefinition } from "../../types/message.js";
import type { IToolExecutionContext } from "../../types/tool.js";
import type { WorkerManager } from "../worker-manager.js";
import type { ProfileLoader } from "../profiles/profile-loader.js";
import type { CliProviderType } from "../constants.js";
import { CLI_PROVIDERS } from "../constants.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Category for all orchestration tools. */
const ORCH_CATEGORY: ToolCategory = "shell";

/** Create a success IToolResult. */
function successResult(name: string, data: Record<string, unknown>): IToolResult {
  return {
    toolCallId: "",
    name,
    content: JSON.stringify(data),
    isError: false,
  };
}

/** Create an error IToolResult. */
function errorResult(name: string, error: string): IToolResult {
  return {
    toolCallId: "",
    name,
    content: JSON.stringify({ success: false, error }),
    isError: true,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Create the five orchestration tools as IToolRegistration objects.
 *
 * These are registered into the shared ToolRegistry so the supervisor
 * LLM sees them alongside built-in tools in its tool definitions.
 *
 * @param workerManager  Manages worker lifecycle and task execution.
 * @param profileLoader  Resolves agent profiles and their default providers.
 * @param defaultProvider Default CLI provider when none is specified.
 * @returns Array of IToolRegistration objects ready for ToolRegistry.register().
 */
export function createOrchestrationTools(
  workerManager: WorkerManager,
  profileLoader: ProfileLoader,
  defaultProvider: CliProviderType,
): IToolRegistration[] {
  return [
    // ── handoff ───────────────────────────────────────────────────────
    createHandoffTool(workerManager, profileLoader, defaultProvider),

    // ── assign ────────────────────────────────────────────────────────
    createAssignTool(workerManager, profileLoader, defaultProvider),

    // ── collect_results ───────────────────────────────────────────────
    createCollectResultsTool(workerManager),

    // ── send_message ──────────────────────────────────────────────────
    createSendMessageTool(workerManager),

    // ── list_workers ──────────────────────────────────────────────────
    createListWorkersTool(workerManager),
  ];
}

// ── Individual Tool Factories ─────────────────────────────────────────────

/**
 * handoff — Delegate a task to a specialized agent and wait for the result.
 *
 * Lifecycle: spawn worker → send task → wait for completion → extract
 * response → destroy worker. The caller blocks until the worker finishes.
 *
 * Use for sequential tasks where the result is needed before proceeding.
 */
function createHandoffTool(
  workerManager: WorkerManager,
  profileLoader: ProfileLoader,
  defaultProvider: CliProviderType,
): IToolRegistration {
  const definition: IToolDefinition = {
    name: "handoff",
    description:
      "Delegate a task to a specialized agent and wait for the result. " +
      "Use for sequential tasks where the result is needed before proceeding.",
    parameters: [
      {
        name: "agent_profile",
        type: "string",
        description: "Agent profile name (e.g. 'developer', 'reviewer', 'tester')",
        required: true,
      },
      {
        name: "message",
        type: "string",
        description: "Task description to send to the agent",
        required: true,
      },
      {
        name: "provider",
        type: "string",
        description: "Override the CLI provider for this worker",
        required: false,
        enum: CLI_PROVIDERS as unknown as readonly string[],
      },
      {
        name: "timeout_seconds",
        type: "number",
        description: "Maximum seconds to wait for completion (default: 600)",
        required: false,
        default: 600,
      },
    ],
  };

  return {
    definition,
    category: ORCH_CATEGORY,
    requiresApproval: (_context: IToolExecutionContext, _args: Record<string, unknown>) => false,
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const agentProfile = args["agent_profile"] as string;
      const message = args["message"] as string;
      const provider = (args["provider"] as CliProviderType | undefined)
        ?? profileLoader.resolveProvider(agentProfile, defaultProvider);
      const timeoutSeconds = (args["timeout_seconds"] as number | undefined) ?? 600;
      const timeoutMs = timeoutSeconds * 1000;

      let worker: { terminalId: string } | undefined;

      try {
        worker = await workerManager.spawnWorker({
          agentProfile,
          provider,
        });

        await workerManager.sendTask(worker.terminalId, message);

        const completed = await workerManager.waitForCompletion(
          worker.terminalId,
          timeoutMs,
        );

        if (!completed) {
          return errorResult("handoff", `Worker timed out after ${timeoutSeconds}s`);
        }

        const output = await workerManager.extractResponse(worker.terminalId);
        return successResult("handoff", { success: true, output });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return errorResult("handoff", errMsg);
      } finally {
        // Always clean up the worker
        if (worker) {
          try {
            await workerManager.destroyWorker(worker.terminalId);
          } catch {
            // Best effort cleanup — ignore errors
          }
        }
      }
    },
  };
}

/**
 * assign — Spawn a parallel worker and return immediately.
 *
 * Lifecycle: spawn worker → send task → return terminal ID.
 * The worker runs in the background. Use collect_results() later
 * to gather the output and destroy the worker.
 *
 * Use for independent parallel tasks that can run concurrently.
 */
function createAssignTool(
  workerManager: WorkerManager,
  profileLoader: ProfileLoader,
  defaultProvider: CliProviderType,
): IToolRegistration {
  const definition: IToolDefinition = {
    name: "assign",
    description:
      "Spawn a parallel worker and return immediately. " +
      "Returns a terminal ID. Use collect_results() later to gather output.",
    parameters: [
      {
        name: "agent_profile",
        type: "string",
        description: "Agent profile name (e.g. 'developer', 'reviewer', 'tester')",
        required: true,
      },
      {
        name: "message",
        type: "string",
        description: "Task description to send to the agent",
        required: true,
      },
      {
        name: "provider",
        type: "string",
        description: "Override the CLI provider for this worker",
        required: false,
        enum: CLI_PROVIDERS as unknown as readonly string[],
      },
    ],
  };

  return {
    definition,
    category: ORCH_CATEGORY,
    requiresApproval: (_context: IToolExecutionContext, _args: Record<string, unknown>) => false,
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const agentProfile = args["agent_profile"] as string;
      const message = args["message"] as string;
      const provider = (args["provider"] as CliProviderType | undefined)
        ?? profileLoader.resolveProvider(agentProfile, defaultProvider);

      try {
        const worker = await workerManager.spawnWorker({
          agentProfile,
          provider,
        });

        await workerManager.sendTask(worker.terminalId, message);

        return successResult("assign", {
          success: true,
          terminalId: worker.terminalId,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return errorResult("assign", errMsg);
      }
    },
  };
}

/**
 * collect_results — Wait for assigned workers to complete and collect results.
 *
 * Lifecycle: wait for each worker → extract response → destroy worker.
 * All workers are destroyed after collection, regardless of success.
 *
 * Processes all terminal IDs concurrently via Promise.allSettled.
 */
function createCollectResultsTool(
  workerManager: WorkerManager,
): IToolRegistration {
  const definition: IToolDefinition = {
    name: "collect_results",
    description:
      "Wait for assigned workers to complete and collect their results. " +
      "Workers are destroyed after collection.",
    parameters: [
      {
        name: "terminal_ids",
        type: "string",
        description: "Comma-separated terminal IDs from assign()",
        required: true,
      },
      {
        name: "timeout_seconds",
        type: "number",
        description: "Maximum seconds to wait for each worker (default: 600)",
        required: false,
        default: 600,
      },
    ],
  };

  return {
    definition,
    category: ORCH_CATEGORY,
    requiresApproval: (_context: IToolExecutionContext, _args: Record<string, unknown>) => false,
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const rawIds = args["terminal_ids"] as string;
      const ids = rawIds.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      const timeoutSeconds = (args["timeout_seconds"] as number | undefined) ?? 600;
      const timeoutMs = timeoutSeconds * 1000;

      interface CollectResult {
        terminalId: string;
        success: boolean;
        output?: string | undefined;
        error?: string | undefined;
      }

      const settled = await Promise.allSettled(
        ids.map(async (tid): Promise<CollectResult> => {
          const ok = await workerManager.waitForCompletion(tid, timeoutMs);
          const output = ok
            ? await workerManager.extractResponse(tid)
            : undefined;

          // Always destroy the worker after collection
          try {
            await workerManager.destroyWorker(tid);
          } catch {
            // Best effort cleanup
          }

          return {
            terminalId: tid,
            success: ok,
            output,
            error: ok ? undefined : `Timed out after ${timeoutSeconds}s`,
          };
        }),
      );

      const results: CollectResult[] = settled.map((s) => {
        if (s.status === "fulfilled") {
          return s.value;
        }
        // Promise was rejected — extract the error
        const reason = s.reason instanceof Error
          ? s.reason.message
          : String(s.reason);
        return {
          terminalId: "unknown",
          success: false,
          error: reason,
        };
      });

      return successResult("collect_results", { results });
    },
  };
}

/**
 * send_message — Send a message to a running worker.
 *
 * If the worker is idle or completed, the message is delivered immediately.
 * If the worker is busy (processing), the message is queued in the inbox
 * and delivered automatically when the worker becomes idle.
 */
function createSendMessageTool(
  workerManager: WorkerManager,
): IToolRegistration {
  const definition: IToolDefinition = {
    name: "send_message",
    description:
      "Send a message to a running worker. " +
      "Delivered immediately if idle, queued if busy.",
    parameters: [
      {
        name: "terminal_id",
        type: "string",
        description: "Target terminal ID",
        required: true,
      },
      {
        name: "message",
        type: "string",
        description: "Message content to send",
        required: true,
      },
    ],
  };

  return {
    definition,
    category: ORCH_CATEGORY,
    requiresApproval: (_context: IToolExecutionContext, _args: Record<string, unknown>) => false,
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const tid = args["terminal_id"] as string;
      const msg = args["message"] as string;

      try {
        const status = workerManager.getStatus(tid);

        // Deliver immediately if the worker is ready
        if (status === "idle" || status === "completed") {
          await workerManager.sendTask(tid, msg);
          return successResult("send_message", { delivered: true });
        }

        // Queue for later delivery via inbox polling
        const msgId = workerManager.state.queueMessage({
          from: "supervisor",
          to: tid,
          content: msg,
        });

        return successResult("send_message", {
          queued: true,
          messageId: msgId,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return errorResult("send_message", errMsg);
      }
    },
  };
}

/**
 * list_workers — List all active workers with their status and profile.
 *
 * Returns an array of worker objects with terminal ID, agent profile,
 * CLI provider, and current live status (read from terminal output).
 */
function createListWorkersTool(
  workerManager: WorkerManager,
): IToolRegistration {
  const definition: IToolDefinition = {
    name: "list_workers",
    description:
      "List all active workers with their terminal ID, agent profile, " +
      "CLI provider, and current status.",
    parameters: [],
  };

  return {
    definition,
    category: ORCH_CATEGORY,
    requiresApproval: (_context: IToolExecutionContext, _args: Record<string, unknown>) => false,
    execute: (_args: Record<string, unknown>): Promise<IToolResult> => {
      const terminals = workerManager.state.listTerminals(
        workerManager.sessionId,
      );

      const workers = terminals.map((t) => ({
        terminalId: t.id,
        agentProfile: t.agentProfile,
        provider: t.provider,
        status: workerManager.getStatus(t.id),
      }));

      return Promise.resolve(successResult("list_workers", { workers }));
    },
  };
}
