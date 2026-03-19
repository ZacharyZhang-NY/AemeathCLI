/**
 * OrchestratorEngine — the supervisor tool-calling loop.
 *
 * Uses the existing IModelProvider.stream() / ToolRegistry.execute()
 * interfaces to drive a while-loop that delegates work to CLI-based
 * worker agents via orchestration tools (handoff, assign, collect_results,
 * send_message, list_workers).
 *
 * Supports two modes:
 * - Single-shot: run(task, opts) — processes one task and returns
 * - Interactive:  repl(opts)     — persistent REPL with shared workers
 *
 * @see IMPLEMENT_PLAN.md Section 8.4
 */

import { randomUUID } from "node:crypto";
import * as readline from "node:readline";

import type { IModelProvider } from "../providers/types.js";
import type {
  IChatRequest,
  IChatMessage,
  IStreamChunk,
  IToolDefinition,
  IToolCall,
} from "../types/message.js";
import type {
  IToolRegistry,
  IToolExecutionContext,
} from "../types/tool.js";
import type {
  ProviderName,
  ModelRole,
  IGlobalConfig,
} from "../types/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ModelRouter } from "../core/model-router.js";
import type { CostTracker } from "../core/cost-tracker.js";
import type { EventBus } from "../core/event-bus.js";

import type { PtySessionManager } from "./pty/session-manager.js";
import type { CliProviderManager } from "./cli-providers/cli-provider-manager.js";
import type { StateStore } from "./state-store.js";
import { WorkerManager } from "./worker-manager.js";
import { TmuxOverlay } from "./pty/tmux-overlay.js";
import type { ProfileLoader } from "./profiles/profile-loader.js";
import { createOrchestrationTools } from "./tools/orchestration-tools.js";
import type { CliProviderType, AgentProfile } from "./constants.js";
import {
  DEFAULT_CLI_PROVIDER,
  MAX_ORCHESTRATOR_STEPS,
  MAX_OUTPUT_EXTRACT_BYTES,
  INBOX_POLL_INTERVAL_MS,
} from "./constants.js";

// ── Public Interfaces ─────────────────────────────────────────────────────

/** Options for running the orchestrator (single-shot or REPL). */
export interface RunOptions {
  readonly supervisorProfile?: string | undefined;
  readonly supervisorModel?: string | undefined;
  readonly defaultWorkerProvider?: CliProviderType | undefined;
  readonly workingDirectory?: string | undefined;
  readonly visual?: boolean | undefined;
  readonly maxSteps?: number | undefined;
}

/** Result returned from a single-shot orchestrator run. */
export interface OrchestratorResult {
  readonly output: string;
  readonly steps: number;
  readonly totalCost: number;
}

/**
 * Explicit dependency interface — all typed fields the engine requires.
 *
 * Passed to the constructor to enable testing with mocks and to make
 * the dependency graph visible at the call site.
 */
export interface OrchestratorDeps {
  readonly sessionManager: PtySessionManager;
  readonly cliProviderManager: CliProviderManager;
  readonly state: StateStore;
  readonly providerRegistry: ProviderRegistry;
  readonly modelRouter: ModelRouter;
  readonly toolRegistry: IToolRegistry;
  readonly toolContext: IToolExecutionContext;
  readonly costTracker: CostTracker;
  readonly profileLoader: ProfileLoader;
  readonly config: IGlobalConfig;
  readonly eventBus: EventBus;
  readonly sessionId: string;
  readonly workingDirectory: string;
}

// ── Internal Types ────────────────────────────────────────────────────────

/** Resolved session state from prepareSession(). */
interface SessionContext {
  readonly sdkProvider: IModelProvider;
  readonly resolution: { readonly modelId: string; readonly provider: string };
  readonly systemPrompt: string;
  readonly toolDefs: readonly IToolDefinition[];
  readonly toolContext: IToolExecutionContext;
}

// ── OrchestratorEngine ────────────────────────────────────────────────────

/**
 * The core orchestrator engine.
 *
 * Drives a supervisor LLM via a streaming tool-calling loop. The supervisor
 * sees orchestration tools (handoff, assign, etc.) alongside built-in tools
 * and can delegate work to CLI-based worker agents running in PTY sessions.
 */
export class OrchestratorEngine {
  private readonly workerManager: WorkerManager;
  private readonly tmuxOverlay: TmuxOverlay;
  private inboxTimer: ReturnType<typeof setInterval> | null = null;
  private orchestrationToolsRegistered = false;
  private inboxDeliveryInFlight = false;
  private sessionStopped = false;

  constructor(private readonly deps: OrchestratorDeps) {
    this.workerManager = new WorkerManager(
      deps.sessionManager,
      deps.cliProviderManager,
      deps.profileLoader,
      deps.state,
      deps.sessionId,
      deps.workingDirectory,
    );
    this.tmuxOverlay = new TmuxOverlay();
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Run orchestrator in single-shot mode.
   *
   * Manages the full lifecycle: start session, process task, stop session.
   * Returns the final output, step count, and total cost.
   *
   * @param task The task description to process.
   * @param opts Run options (supervisor model, worker provider, etc.).
   * @returns OrchestratorResult with output, steps, and cost.
   */
  async run(task: string, opts: RunOptions): Promise<OrchestratorResult> {
    this.startSession(opts);
    try {
      const ctx = this.prepareSession(opts);
      const messages: IChatMessage[] = [];
      const maxSteps = opts.maxSteps ?? MAX_ORCHESTRATOR_STEPS;

      // Consume the stream, collect final output
      let output = "";
      for await (const chunk of this.streamTask(task, ctx, messages, maxSteps)) {
        if (chunk.type === "text" && chunk.content) {
          output += chunk.content;
        }
      }

      // If no streamed text, fall back to last assistant message
      if (!output) {
        const lastAssistant = [...messages]
          .reverse()
          .find((m) => m.role === "assistant");
        output = lastAssistant?.content ?? "";
      }

      this.deps.eventBus.emit("task:completed", {
        taskId: this.deps.sessionId,
      });

      return {
        output,
        steps: messages.filter((m) => m.role === "assistant").length,
        totalCost: this.deps.costTracker.getSessionTotal(),
      };
    } finally {
      await this.stopSession();
    }
  }

  /**
   * Run orchestrator in interactive REPL mode.
   *
   * Workers persist between turns — assign() in one turn, collect_results()
   * in a later turn. The session lifecycle is managed here, not per-turn.
   *
   * Commands:
   * - /help     — show REPL commands and examples
   * - /workers  — list active workers
   * - /quit     — exit REPL
   *
   * @param opts Run options.
   */
  async repl(opts: RunOptions): Promise<void> {
    this.startSession(opts);
    let rl: readline.Interface | undefined;
    try {
      const ctx = this.prepareSession(opts);
      const messages: IChatMessage[] = [];
      const maxSteps = opts.maxSteps ?? MAX_ORCHESTRATOR_STEPS;

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "> ",
      });

      const profileName = opts.supervisorProfile ?? "supervisor";
      process.stdout.write(
        `AemeathCLI Orchestrator | Profile: ${profileName}\n` +
        "Type a task to delegate work.\n" +
        "Examples:\n" +
        '  Refactor the auth module and add tests.\n' +
        '  Review the latest diff for security issues.\n' +
        '  Investigate why the build fails on CI.\n' +
        "Commands: /help, /workers, /quit\n\n",
      );
      rl.prompt();

      for await (const line of rl) {
        const trimmed = line.trim();

        if (trimmed === "/help") {
          process.stdout.write(
            "Commands:\n" +
            "  /help     Show REPL commands and example tasks\n" +
            "  /workers  List active workers in this session\n" +
            "  /quit     Exit the orchestrator REPL\n\n" +
            "Examples:\n" +
            "  Fix the failing Vitest tests in src/auth.\n" +
            "  Audit the current branch for release blockers.\n" +
            "  Compare this project against the reference orchestrator.\n",
          );
          rl.prompt();
          continue;
        }

        if (trimmed === "/quit") {
          break;
        }

        if (trimmed === "/workers") {
          const terminals = this.workerManager.state.listTerminals(
            this.workerManager.sessionId,
          );
          const rows = terminals.map((t) => ({
            id: t.id,
            profile: t.agentProfile ?? "unknown",
            provider: t.provider,
            status: this.workerManager.getStatus(t.id),
          }));
          if (rows.length === 0) {
            process.stdout.write("No active workers.\n");
          } else {
            for (const row of rows) {
              process.stdout.write(
                `${row.id} profile=${row.profile} provider=${row.provider} status=${row.status}\n`,
              );
            }
          }
          rl.prompt();
          continue;
        }

        if (trimmed.length === 0) {
          rl.prompt();
          continue;
        }

        // Stream one task — workers persist between turns
        for await (const chunk of this.streamTask(trimmed, ctx, messages, maxSteps)) {
          if (chunk.type === "text" && chunk.content) {
            process.stdout.write(chunk.content);
          }
        }
        process.stdout.write("\n\n");
        rl.prompt();
      }
    } finally {
      rl?.close();
      await this.stopSession();
    }
  }

  /**
   * Register signal handlers for clean shutdown.
   *
   * Destroys all workers, stops inbox delivery, and tears down tmux
   * on SIGINT or SIGTERM. Should be called once at orchestrator startup.
   */
  setupSignalHandlers(): void {
    const cleanup = async (): Promise<void> => {
      await this.stopSession();
      process.exit(0);
    };
    process.on("SIGINT", () => void cleanup());
    process.on("SIGTERM", () => void cleanup());
  }

  // ── Private: Session Lifecycle ──────────────────────────────────────

  /**
   * Start session lifecycle: inbox delivery and optional tmux overlay.
   */
  private startSession(opts: RunOptions): void {
    this.deps.state.createSession({
      sessionId: this.deps.sessionId,
      pid: process.pid,
      workerCount: 0,
      providers: [],
      createdAt: new Date(),
    });
    if (opts.visual && this.tmuxOverlay.isAvailable()) {
      this.tmuxOverlay.createSession(
        `ac-${opts.supervisorProfile ?? "supervisor"}`,
      );
    }
    this.startInboxDelivery();
  }

  /**
   * Stop session lifecycle: inbox delivery, all workers, tmux overlay.
   */
  private async stopSession(): Promise<void> {
    if (this.sessionStopped) {
      return;
    }
    this.sessionStopped = true;
    this.stopInboxDelivery();
    await this.workerManager.destroyAll();
    this.deps.state.deleteSession(this.deps.sessionId);
    this.tmuxOverlay.destroy();
    this.deps.state.close();
  }

  /**
   * Prepare shared resources for a session.
   *
   * Resolves the supervisor model + provider, registers orchestration
   * tools, builds the system prompt, and assembles the tool execution
   * context. Called once per session (not per-turn in REPL mode).
   */
  private prepareSession(opts: RunOptions): SessionContext {
    // Apply supervisor model override if specified
    if (opts.supervisorModel) {
      this.deps.modelRouter.setUserOverride(opts.supervisorModel);
    }

    // Resolve the supervisor model via the priority pipeline
    const resolution = this.deps.modelRouter.resolve("planning" as ModelRole);

    // Get the provider adapter for the resolved model
    const sdkProvider = this.deps.providerRegistry.getForModel(resolution.modelId);

    // Register orchestration tools (once)
    this.ensureToolsRegistered(
      opts.defaultWorkerProvider ?? DEFAULT_CLI_PROVIDER,
    );

    // Get all tool definitions (built-in + orchestration)
    const toolDefs = this.deps.toolRegistry.getDefinitions();

    // Load the supervisor profile and build the system prompt
    const profile = this.deps.profileLoader.load(
      opts.supervisorProfile ?? "supervisor",
    );
    const systemPrompt = this.buildSystemPrompt(profile, opts);

    // Assemble the tool execution context
    return {
      sdkProvider,
      resolution: {
        modelId: resolution.modelId,
        provider: resolution.provider,
      },
      systemPrompt,
      toolDefs,
      toolContext: this.deps.toolContext,
    };
  }

  // ── Private: Tool Loop ──────────────────────────────────────────────

  /**
   * Stream a single task through the supervisor tool-calling loop.
   *
   * This is an async generator that yields IStreamChunk objects. It:
   * 1. Adds the user message to the conversation
   * 2. Streams the LLM response (yielding text chunks)
   * 3. If the LLM made tool calls, executes them and loops
   * 4. Stops when the LLM returns without tool calls or budget is exceeded
   *
   * Does NOT manage lifecycle (workers, inbox, tmux) — the caller
   * (run() or repl()) handles that.
   */
  private async *streamTask(
    task: string,
    ctx: SessionContext,
    messages: IChatMessage[],
    maxSteps: number,
  ): AsyncGenerator<IStreamChunk> {
    // Add the user message
    messages.push(this.createMessage("user", task));

    let step = 0;
    while (step < maxSteps) {
      // Build the chat request
      const request: IChatRequest = {
        model: ctx.resolution.modelId,
        messages,
        system: ctx.systemPrompt,
        tools: ctx.toolDefs,
      };

      // Stream the supervisor response
      let fullContent = "";
      const toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }> = [];

      for await (const chunk of ctx.sdkProvider.stream(request)) {
        // Yield text chunks to the caller
        if (chunk.type === "text" && chunk.content) {
          fullContent += chunk.content;
          yield chunk;
        }

        // Collect tool calls
        if (chunk.type === "tool_call" && chunk.toolCall) {
          toolCalls.push({
            id: chunk.toolCall.id,
            name: chunk.toolCall.name,
            arguments: chunk.toolCall.arguments,
          });
        }

        // Record token usage for cost tracking
        if (chunk.type === "usage" && chunk.usage) {
          this.deps.costTracker.record(
            ctx.resolution.provider as ProviderName,
            ctx.resolution.modelId,
            chunk.usage.inputTokens,
            chunk.usage.outputTokens,
            "planning" as ModelRole,
          );
        }
      }

      // Build the assistant message
      const assistantMsg = this.createMessage("assistant", fullContent);
      if (toolCalls.length > 0) {
        // Attach tool calls to the assistant message
        const msgWithTools: IChatMessage = {
          ...assistantMsg,
          toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        };
        messages.push(msgWithTools);
      } else {
        messages.push(assistantMsg);
      }

      // No tool calls means the supervisor is done
      if (toolCalls.length === 0) break;

      // Check budget before executing tools
      if (this.deps.costTracker.isBudgetExceeded()) break;

      // Execute each tool call and append results as tool messages
      for (const call of toolCalls) {
        const toolCall: IToolCall = {
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        };

        const result = await this.deps.toolRegistry.execute(
          toolCall,
          ctx.toolContext,
        );

        // Truncate large tool results to prevent context overflow
        const content =
          result.content.length > MAX_OUTPUT_EXTRACT_BYTES
            ? result.content.slice(0, MAX_OUTPUT_EXTRACT_BYTES) + "\n[truncated]"
            : result.content;

        messages.push(this.createToolResultMessage(content, toolCall));
      }

      step++;
    }

    yield { type: "done" as const };
  }

  // ── Private: Orchestration Tools ────────────────────────────────────

  /**
   * Register orchestration tools into the shared ToolRegistry.
   *
   * Runs only once (guarded by flag). This ensures tools are not
   * duplicated in REPL mode where prepareSession() may be called
   * once but streamTask() runs multiple times.
   */
  private ensureToolsRegistered(
    defaultWorkerProvider: CliProviderType,
  ): void {
    if (this.orchestrationToolsRegistered) return;

    const orchTools = createOrchestrationTools(
      this.workerManager,
      this.deps.profileLoader,
      defaultWorkerProvider,
    );

    for (const tool of orchTools) {
      this.deps.toolRegistry.register(tool);
    }

    this.orchestrationToolsRegistered = true;
  }

  // ── Private: Inbox Delivery ─────────────────────────────────────────

  /**
   * Start the inbox delivery polling loop.
   *
   * Every INBOX_POLL_INTERVAL_MS, checks each terminal for pending
   * messages. If the terminal is idle or completed, delivers the
   * oldest pending message and marks it as delivered.
   */
  private startInboxDelivery(): void {
    this.inboxTimer = setInterval(() => {
      if (this.inboxDeliveryInFlight) {
        return;
      }

      this.inboxDeliveryInFlight = true;
      void this.deliverPendingMessages()
        .finally(() => {
          this.inboxDeliveryInFlight = false;
        });
    }, INBOX_POLL_INTERVAL_MS);
  }

  /**
   * Deliver pending inbox messages to idle workers.
   *
   * Only delivers one message per worker per cycle to avoid
   * overwhelming workers that just became idle.
   */
  private async deliverPendingMessages(): Promise<void> {
    const terminals = this.workerManager.state.listTerminals(
      this.workerManager.sessionId,
    );

    for (const terminal of terminals) {
      const status = this.workerManager.getStatus(terminal.id);
      if (status !== "idle" && status !== "completed") continue;

      const pending = this.workerManager.state.getPendingMessages(terminal.id);
      if (pending.length === 0) continue;

      const firstMsg = pending[0];
      if (!firstMsg) continue;

      try {
        await this.workerManager.sendTask(terminal.id, firstMsg.content);
        this.workerManager.state.markDelivered(firstMsg.id);
      } catch {
        this.workerManager.state.markFailed(firstMsg.id);
      }
    }
  }

  /** Stop the inbox delivery polling loop. */
  private stopInboxDelivery(): void {
    if (this.inboxTimer) {
      clearInterval(this.inboxTimer);
      this.inboxTimer = null;
    }
    this.inboxDeliveryInFlight = false;
  }

  // ── Private: Helpers ────────────────────────────────────────────────

  /**
   * Create an IChatMessage.
   *
   * For tool result messages, includes the toolCallId field that links
   * the result back to its originating IToolCall (required by providers
   * for multi-tool-call responses).
   *
   * @param role      Message role: "user", "assistant", or "tool".
   * @param content   Message content.
   * @param toolCallId Optional tool call ID (for "tool" role messages).
   * @returns A fully-formed IChatMessage.
   */
  private createMessage(
    role: "user" | "tool" | "assistant",
    content: string,
    toolCallId?: string,
  ): IChatMessage {
    const base: IChatMessage = {
      id: randomUUID(),
      role,
      content,
      createdAt: new Date(),
    };

    // For tool result messages, add the toolCallId field.
    // This links the result to its originating IToolCall.id so providers
    // can correctly associate results with their calls.
    if (toolCallId !== undefined) {
      return { ...base, toolCallId } as IChatMessage;
    }

    return base;
  }

  private createToolResultMessage(content: string, toolCall: IToolCall): IChatMessage {
    return {
      id: randomUUID(),
      role: "tool",
      content,
      toolCallId: toolCall.id,
      toolCalls: [{
        id: toolCall.id,
        name: toolCall.name,
        arguments: {},
      }],
      createdAt: new Date(),
    };
  }

  /**
   * Build the supervisor system prompt.
   *
   * Combines the profile's system prompt with contextual information
   * about available agent profiles, orchestration tools, and guidelines
   * for when to use sequential vs parallel delegation.
   */
  private buildSystemPrompt(profile: AgentProfile, opts: RunOptions): string {
    const profiles = this.deps.profileLoader.listProfiles();
    const profileList = profiles
      .map((p) => `- ${p.name}: ${p.description}`)
      .join("\n");

    const workDir = opts.workingDirectory ?? this.deps.workingDirectory;

    return `${profile.systemPrompt}

## Available Agent Profiles
${profileList}

## Orchestration Tools
- handoff(agent_profile, message) — delegate task, wait for result (sequential)
- assign(agent_profile, message) — spawn parallel worker, returns immediately
- collect_results(terminal_ids) — gather outputs from assigned workers
- send_message(terminal_id, message) — message a running worker
- list_workers() — show active workers

## Guidelines
- Use handoff() for tasks where you need the result before proceeding
- Use assign() + collect_results() for independent parallel tasks
- Workers are independent CLI agents with full file/bash access in ${workDir}
- Each worker gets a fresh terminal session with the specified CLI tool
- Workers are destroyed after handoff() returns or collect_results() gathers output`;
  }
}
