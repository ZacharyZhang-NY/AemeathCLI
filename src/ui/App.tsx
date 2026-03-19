/**
 * Root TUI application component per PRD section 6.2
 * Orchestrates the entire interactive chat experience
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { render } from "ink";
import { SinglePane } from "./layouts/SinglePane.js";
import { SplitPane } from "./layouts/SplitPane.js";
import { useModel } from "./hooks/useModel.js";
import { useStream } from "./hooks/useStream.js";
import { useCost } from "./hooks/useCost.js";
import { usePanel } from "./hooks/usePanel.js";
import type {
  IChatMessage,
  ModelRole,
  IGlobalConfig,
  IStreamChunk,
  IAgentState,
  AgentStatus,
  ProviderName,
  IModelResolution,
  IPaneConfig,
  ILayoutConfig,
  PaneLayout,
} from "../types/index.js";
import {
  DEFAULT_CONFIG,
  SUPPORTED_MODELS,
  PROVIDER_MODEL_ORDER,
  getThinkingConfigForModel,
} from "../types/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { TeamManager } from "../teams/team-manager.js";
import { v4Id } from "./utils.js";
import { SLASH_COMMANDS, registerDynamicSkills } from "./autocomplete-data.js";
import { ModelSelector } from "./components/ModelSelector.js";
import { ThinkingSelector } from "./components/ThinkingSelector.js";
import { LoginSelector } from "./components/LoginSelector.js";

interface IChatSessionOptions {
  readonly initialMessage?: string | undefined;
  readonly model?: string | undefined;
  readonly role?: string | undefined;
  readonly systemPrompt?: string | undefined;
  readonly streaming?: boolean | undefined;
  readonly isAgentPane?: boolean | undefined;
}

interface IAppProps {
  readonly config: IGlobalConfig;
  readonly options: IChatSessionOptions;
}

function getCandidateModels(
  config: IGlobalConfig,
  resolution: IModelResolution,
  activeModelId: string,
): readonly string[] {
  const candidates: string[] = [activeModelId];

  if (resolution.source !== "user_override" && resolution.role) {
    const roleConfig = config.roles[resolution.role];
    if (roleConfig) {
      candidates.push(roleConfig.primary, ...roleConfig.fallback);
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const modelId of candidates) {
    if (!seen.has(modelId)) {
      seen.add(modelId);
      unique.push(modelId);
    }
  }

  return unique;
}

type SelectionMode =
  | { readonly type: "none" }
  | { readonly type: "model" }
  | { readonly type: "thinking"; readonly modelId: string }
  | { readonly type: "login" };

const DEFAULT_SYSTEM_PROMPT =
  "You are AemeathCLI (aemeathcli), a multi-model AI agent orchestrator. " +
  "You help users with coding tasks, code review, debugging, refactoring, and project management. " +
  "You are NOT Claude Code, Codex, or Gemini CLI — you are Aemeath Agent Swarm, an independent tool " +
  "that orchestrates multiple AI providers (Anthropic, OpenAI, Google, Kimi, Ollama).\n\n" +
  "Answer concisely and directly. Key features:\n" +
  "- Multi-model: /model to switch between Claude, GPT, Gemini, Kimi, Ollama\n" +
  "- Agent orchestration: `ac launch` starts the orchestrator with AI-driven worker delegation\n" +
  "  - `ac launch --task \"...\"` for single-shot orchestration\n" +
  "  - `ac launch --visual` for tmux split-panel view\n" +
  "  - `ac launch --worker-provider codex` to use Codex workers\n" +
  "  - The supervisor AI decides when to use handoff/assign tools — no manual setup needed\n" +
  "- Skills: $review, $commit, $plan, $debug, $test, $refactor\n" +
  "- Commands: /help, /model, /role, /history, /resume, /cost\n\n" +
  "When users ask about agent swarm, multi-agent, team mode, or orchestration, " +
  "tell them to use `ac launch` (or `aemeathcli launch`). " +
  "This chat mode is for direct conversation — `ac launch` is the orchestrator.";

function App({ config, options }: IAppProps): React.ReactElement {
  const { resolution, modelId, switchModel, switchRole } = useModel(
    config,
    options.model,
    options.role as ModelRole | undefined,
  );
  const { state: streamState, startStream, cancelStream, reset: resetStream } = useStream();
  const { totalCost, totalTokens, record } = useCost(config.cost);

  // Refs for stable cost/token access inside closures (avoids stale values)
  const totalCostRef = useRef(totalCost);
  totalCostRef.current = totalCost;
  const totalTokensRef = useRef(totalTokens);
  totalTokensRef.current = totalTokens;
  const panel = usePanel();

  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Ref for stable message access inside async callbacks (avoids stale closure)
  const messagesRef = useRef<IChatMessage[]>([]);
  messagesRef.current = messages;
  const [gitBranch, setGitBranch] = useState<string | undefined>();
  const [thinkingValue, setThinkingValue] = useState<string>("medium");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>({ type: "none" });

  // Dynamic model display order — populated by model discovery on mount
  const [modelDisplayOrder, setModelDisplayOrder] = useState<
    Readonly<Record<string, readonly import("../types/model.js").IModelDisplayEntry[]>> | undefined
  >(undefined);

  // Persistent input history — loaded from disk on mount for cross-session arrow-up
  const [persistentHistory, setPersistentHistory] = useState<string[]>([]);

  // Interaction mode — default to agent-swarm (orchestrator), Shift+Tab cycles
  const [inputMode, setInputMode] = useState<import("./components/InputBar.js").InputMode>("agent-swarm");

  // Current conversation ID for history persistence
  const conversationIdRef = useRef<string | undefined>(undefined);

  // Cached provider registry — initialized lazily on first use
  const registryRef = useRef<ProviderRegistry | undefined>(undefined);

  const getRegistry = useCallback(async (): Promise<ProviderRegistry> => {
    if (registryRef.current !== undefined) return registryRef.current;
    const { createDefaultRegistry } = await import("../providers/registry.js");
    registryRef.current = await createDefaultRegistry();
    return registryRef.current;
  }, []);

  // Resolve project root once on mount (used for per-project history/persistence)
  const projectRootRef = useRef<string>(process.cwd());
  useEffect(() => {
    import("../utils/pathResolver.js")
      .then(({ findProjectRoot }) => {
        projectRootRef.current = findProjectRoot();
      })
      .catch(() => {});
  }, []);

  // Load per-project persistent input history on mount
  useEffect(() => {
    (async () => {
      try {
        const { findProjectRoot } = await import("../utils/pathResolver.js");
        const root = findProjectRoot();
        projectRootRef.current = root;
        const { loadInputHistory } = await import("../storage/input-history.js");
        const history = await loadInputHistory(root);
        if (history.length > 0) {
          setPersistentHistory(history);
        }
      } catch {
        // Non-critical
      }
    })();
  }, []);

  // Detect git branch on mount using safe execFile
  useEffect(() => {
    import("node:child_process")
      .then(({ execFile }) => {
        execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 2000 }, (error, stdout) => {
          if (!error && stdout) {
            setGitBranch(stdout.trim());
          }
        });
      })
      .catch(() => {
        // Not in a git repo or git not available
      });
  }, []);

  // Discover skills from all directories on mount (populates $ autocomplete)
  useEffect(() => {
    (async () => {
      try {
        const { SkillRegistry } = await import("../skills/registry.js");
        const { findProjectRoot } = await import("../utils/pathResolver.js");
        const registry = new SkillRegistry();
        await registry.initialize(findProjectRoot());
        const all = registry.listAll();
        if (all.length > 0) {
          registerDynamicSkills(
            all.map((s) => ({ label: `$${s.name}`, description: s.description })),
          );
        }
      } catch {
        // Skill discovery failed — keep built-in fallback
      }
    })();
  }, []);

  // Discover models from provider CLIs on mount (populates /model selector)
  useEffect(() => {
    (async () => {
      try {
        const { discoverModels, getDisplayOrder } = await import("../providers/model-discovery.js");
        await discoverModels();
        setModelDisplayOrder(getDisplayOrder());
      } catch {
        // Model discovery failed — keep hardcoded fallback
      }
    })();
  }, []);

  // Handle initial message
  useEffect(() => {
    if (options.initialMessage) {
      void handleSubmit(options.initialMessage);
    }
  }, []);

  const handleSubmit = useCallback(
    async (input: string) => {
      // Handle internal commands
      if (input.startsWith("/")) {
        await handleInternalCommand(input, switchModel, switchRole, {
          totalCost: totalCostRef.current,
          totalTokens: totalTokensRef.current,
          setMessages,
          modelId,
          thinkingValue,
          setThinkingValue,
          setSelectionMode,
          resolution,
          panel: {
            setAgents: panel.setAgents,
            activate: panel.activate,
            deactivate: panel.deactivate,
            appendOutput: panel.appendOutput,
          },
          getRegistry,
          projectRoot: projectRootRef.current,
        });
        return;
      }

      // Handle $ skill invocation (PRD 12.2)
      if (input.startsWith("$")) {
        await handleSkillInvocation(input, setMessages);
        return;
      }

      // In agent-swarm mode, route through team creation (split panel)
      // unless a team is already running or we're in a sub-pane
      if (
        inputMode === "agent-swarm" &&
        !options.isAgentPane &&
        !panel.isSplitPanelActive &&
        !activeTeamName
      ) {
        setIsProcessing(true);
        try {
          const leaderTask = await handlePromptBasedTeamCreation(
            input, setMessages, panel, getRegistry, modelId,
          );
          if (leaderTask) {
            setTimeout(() => void handleSubmit(leaderTask), 1500);
          }
        } finally {
          setIsProcessing(false);
        }
        return;
      }

      const userMessage: IChatMessage = {
        id: v4Id(),
        role: "user",
        content: input,
        createdAt: new Date(),
      };

      // Persist input to per-project cross-session history (non-blocking)
      import("../storage/input-history.js")
        .then(({ appendInputHistory }) => appendInputHistory(projectRootRef.current, input))
        .catch(() => {});

      setMessages((prev) => [...prev, userMessage]);
      setIsProcessing(true);
      resetStream();

      try {
        const registry = await getRegistry();
        const allMessages = [...messagesRef.current, userMessage].filter((m) => m.role !== "system");
        const candidateModels = getCandidateModels(config, resolution, modelId);

        let responseModel = modelId;
        let responseProvider: ProviderName = resolution.provider;
        let fullContent = "";
        let completed = false;
        let lastError: unknown;

        for (const candidateModel of candidateModels) {
          const provider = registry.hasModel(candidateModel)
            ? registry.getForModel(candidateModel)
            : undefined;

          if (!provider) {
            lastError = new Error(`No provider available for model "${candidateModel}"`);
            continue;
          }

          const candidateProvider = provider;

          let candidateContent = "";
          let caughtError: unknown;

          const stream = candidateProvider.stream({
            model: candidateModel,
            messages: allMessages,
            system: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            maxTokens: 16_000,
          });

          async function* instrumentedStream(
            source: AsyncIterable<IStreamChunk>,
          ): AsyncGenerator<IStreamChunk> {
            try {
              for await (const chunk of source) {
                if (chunk.type === "text" && chunk.content) {
                  candidateContent += chunk.content;
                }
                if (chunk.type === "usage" && chunk.usage) {
                  record(
                    candidateProvider.name as ProviderName,
                    candidateModel,
                    chunk.usage.inputTokens,
                    chunk.usage.outputTokens,
                    resolution.role,
                  );
                }
                if (chunk.type === "error") {
                  caughtError = new Error(
                    chunk.error ?? `Model "${candidateModel}" stream failed`,
                  );
                }
                yield chunk;
              }
            } catch (err: unknown) {
              caughtError = err;
              throw err;
            }
          }

          resetStream();
          await startStream(instrumentedStream(stream));

          if (caughtError !== undefined) {
            lastError = caughtError;
            continue;
          }

          responseModel = candidateModel;
          responseProvider = candidateProvider.name as ProviderName;
          fullContent = candidateContent;
          completed = true;
          break;
        }

        if (!completed) {
          if (lastError instanceof Error) {
            throw lastError;
          }
          throw new Error(
            typeof lastError === "string"
              ? lastError
              : "No model could produce a response",
          );
        }

        if (fullContent.length > 0) {
          const assistantMessage: IChatMessage = {
            id: v4Id(),
            role: "assistant",
            content: fullContent,
            model: responseModel,
            provider: responseProvider,
            createdAt: new Date(),
          };

          setMessages((prev) => {
            const output: IChatMessage[] = [...prev];
            if (responseModel !== modelId) {
              output.push({
                id: v4Id(),
                role: "system",
                content: `Primary model "${modelId}" failed. Switched to fallback "${responseModel}".`,
                createdAt: new Date(),
              });
            }
            output.push(assistantMessage);
            return output;
          });

          // Persist messages to per-project conversation DB (non-blocking)
          persistMessages(projectRootRef.current, userMessage, assistantMessage, responseModel, responseProvider);
        }
      } catch (error: unknown) {
        const errorContent = error instanceof Error ? error.message : String(error);
        const errorMessage: IChatMessage = {
          id: v4Id(),
          role: "assistant",
          content: `Error: ${errorContent}`,
          model: modelId,
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsProcessing(false);
      }
    },
    [
      config,
      modelId,
      resolution,
      options.systemPrompt,
      record,
      switchModel,
      switchRole,
      startStream,
      resetStream,
      getRegistry,
      panel,
      thinkingValue,
    ],
  );

  const handleSubmitSync = useCallback((input: string): void => {
    void handleSubmit(input);
  }, [handleSubmit]);

  const handleCancel = useCallback(() => {
    cancelStream();
    setIsProcessing(false);
  }, [cancelStream]);

  const handleModelSelected = useCallback((selectedModelId: string) => {
    const thinkingCfg = getThinkingConfigForModel(selectedModelId);
    if (thinkingCfg) {
      setSelectionMode({ type: "thinking", modelId: selectedModelId });
    } else {
      switchModel(selectedModelId);
      setSelectionMode({ type: "none" });
      const info = SUPPORTED_MODELS[selectedModelId];
      setMessages((prev) => [
        ...prev,
        { id: v4Id(), role: "system" as const, content: `Switched to model: ${info?.name ?? selectedModelId}`, createdAt: new Date() },
      ]);
    }
  }, [switchModel]);

  const handleThinkingSelected = useCallback((value: string) => {
    if (selectionMode.type !== "thinking") return;
    const { modelId: selectedModelId } = selectionMode;
    switchModel(selectedModelId);
    setThinkingValue(value);
    setSelectionMode({ type: "none" });
    const info = SUPPORTED_MODELS[selectedModelId];
    const cfg = getThinkingConfigForModel(selectedModelId);
    const methodLabel = cfg ? formatThinkingMethod(cfg.method) : "Thinking";
    const optionLabel = cfg?.options.find((o) => o.value === value)?.label ?? value;
    setMessages((prev) => [
      ...prev,
      { id: v4Id(), role: "system" as const, content: `Switched to model: ${info?.name ?? selectedModelId}\n${methodLabel}: ${optionLabel}`, createdAt: new Date() },
    ]);
  }, [selectionMode, switchModel]);

  const handleSelectionCancel = useCallback(() => {
    setSelectionMode({ type: "none" });
  }, []);

  const handleLoginSelected = useCallback(async (provider: string) => {
    setSelectionMode({ type: "none" });

    const loginMsg = provider === "gemini"
      ? "Logging in to gemini... A new terminal window will open for authentication."
      : `Logging in to ${provider}...`;

    setMessages((prev) => [
      ...prev,
      { id: v4Id(), role: "system" as const, content: loginMsg, createdAt: new Date() },
    ]);

    try {
      const loginModule = await loadLoginModuleForSlash(provider as "claude" | "codex" | "gemini" | "kimi");
      await loginModule.login();
      setMessages((prev) => [
        ...prev,
        { id: v4Id(), role: "system" as const, content: `Successfully logged in to ${provider}`, createdAt: new Date() },
      ]);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [
        ...prev,
        { id: v4Id(), role: "system" as const, content: `Login failed: ${msg}`, createdAt: new Date() },
      ]);
    }
  }, []);

  // ── Selection mode renders take priority over normal views ──────────────

  if (selectionMode.type === "login") {
    return (
      <LoginSelector
        onSelect={(provider) => void handleLoginSelected(provider)}
        onCancel={handleSelectionCancel}
      />
    );
  }

  if (selectionMode.type === "model") {
    return (
      <ModelSelector
        currentModelId={modelId}
        onSelect={handleModelSelected}
        onCancel={handleSelectionCancel}
        modelOrder={modelDisplayOrder ?? PROVIDER_MODEL_ORDER}
      />
    );
  }

  if (selectionMode.type === "thinking") {
    const selectedInfo = SUPPORTED_MODELS[selectionMode.modelId];
    return (
      <ThinkingSelector
        modelId={selectionMode.modelId}
        modelName={selectedInfo?.name ?? selectionMode.modelId}
        currentValue={thinkingValue}
        onSelect={handleThinkingSelected}
        onBack={handleSelectionCancel}
      />
    );
  }

  if (panel.isSplitPanelActive) {
    return (
      <SplitPane
        agents={panel.agents}
        activeAgentIndex={panel.activeAgentIndex}
        onSelectAgent={panel.selectAgent}
        agentOutputs={panel.agentOutputs}
        isProcessing={isProcessing}
        onSubmit={handleSubmitSync}
        onCancel={handleCancel}
        model={modelId}
        role={resolution.role}
        tokenCount={totalTokens}
        cost={totalCost}
        gitBranch={gitBranch}
      />
    );
  }

  return (
    <SinglePane
      messages={messages}
      isProcessing={isProcessing}
      onSubmit={handleSubmitSync}
      onCancel={handleCancel}
      model={modelId}
      role={resolution.role}
      tokenCount={totalTokens}
      cost={totalCost}
      gitBranch={gitBranch}
      streamingContent={streamState.content}
      activity={streamState.activity}
      initialHistory={persistentHistory}
      mode={inputMode}
      onModeChange={setInputMode}
    />
  );
}

// ── Helper to add system messages to Ink-managed state ────────────────────

interface IPanelControls {
  readonly setAgents: (agents: readonly IAgentState[]) => void;
  readonly activate: () => void;
  readonly deactivate: () => void;
  readonly appendOutput: (agentId: string, content: string) => void;
}

interface ICommandContext {
  readonly totalCost: string;
  readonly totalTokens: string;
  readonly setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>;
  readonly modelId: string;
  readonly thinkingValue: string;
  readonly setThinkingValue: (value: string) => void;
  readonly setSelectionMode: (mode: SelectionMode) => void;
  readonly resolution: { readonly provider: string; readonly role?: string | undefined };
  readonly panel: IPanelControls;
  readonly getRegistry: () => Promise<ProviderRegistry>;
  /** Current project root — used for per-project history/resume. */
  readonly projectRoot: string;
}

function addSystemMessage(ctx: ICommandContext, content: string): void {
  ctx.setMessages((prev) => [
    ...prev,
    {
      id: v4Id(),
      role: "system" as const,
      content,
      createdAt: new Date(),
    },
  ]);
}

/**
 * Resolve a model selection input — either a model ID or a global index number
 * from the /model display list.
 */
function resolveModelSelection(input: string): string | undefined {
  // Direct model ID match
  if (SUPPORTED_MODELS[input]) {
    return input;
  }

  // Numeric index into the global ordered list
  if (/^\d+$/.test(input)) {
    const index = Number(input);
    let globalIndex = 1;

    for (const entries of Object.values(PROVIDER_MODEL_ORDER)) {
      for (const entry of entries) {
        if (globalIndex === index) {
          return entry.id;
        }
        globalIndex++;
      }
    }
  }

  return undefined;
}

/**
 * Human-readable label for a provider's thinking method.
 */
function formatThinkingMethod(method: string): string {
  switch (method) {
    case "extended_thinking":
      return "Extended Thinking";
    case "reasoning_effort":
      return "Reasoning Effort";
    case "thinking_budget":
      return "Thinking Budget";
    case "thinking_level":
      return "Thinking Level";
    case "thinking_mode":
      return "Thinking Mode";
    default:
      return "Thinking";
  }
}

async function handleInternalCommand(
  input: string,
  switchModel: (model: string) => void,
  switchRole: (role: ModelRole) => void,
  ctx: ICommandContext,
): Promise<void> {
  const parts = input.trim().split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  const arg = args[0];

  switch (command) {
    case "/help": {
      const helpLines = SLASH_COMMANDS.map((cmd) => `  ${cmd.command.padEnd(17)}${cmd.description}`).join("\n");
      addSystemMessage(ctx, helpLines);
      break;
    }

    case "/model": {
      if (arg) {
        // Direct model switch: /model <id-or-number>
        const resolvedId = resolveModelSelection(arg);
        if (!resolvedId) {
          addSystemMessage(ctx, `Unknown model: ${arg}`);
          break;
        }
        const info = SUPPORTED_MODELS[resolvedId];
        if (!info) {
          addSystemMessage(ctx, `Unknown model: ${arg}`);
          break;
        }
        switchModel(resolvedId);
        // Reset thinking to provider default if current value is invalid
        const thinkingCfg = getThinkingConfigForModel(resolvedId);
        if (thinkingCfg) {
          const isValid = thinkingCfg.options.some((o) => o.value === ctx.thinkingValue);
          if (!isValid) ctx.setThinkingValue(thinkingCfg.defaultValue);
        }
        addSystemMessage(ctx, `Switched to model: ${info.name}`);
      } else {
        // Open interactive model selector (up/down arrow key navigation)
        ctx.setSelectionMode({ type: "model" });
      }
      break;
    }

    case "/role": {
      if (arg) {
        const validRoles = ["planning", "coding", "review", "testing", "bugfix", "documentation"];
        if (validRoles.includes(arg)) {
          switchRole(arg as ModelRole);
          addSystemMessage(ctx, `Switched to role: ${arg}`);
        } else {
          addSystemMessage(ctx, `Unknown role: ${arg}\nValid roles: ${validRoles.join(", ")}`);
        }
      } else {
        addSystemMessage(ctx, `Current role: ${ctx.resolution.role ?? "default"}`);
      }
      break;
    }

    case "/cost":
      addSystemMessage(ctx, `Session cost: ${ctx.totalCost} | Tokens: ${ctx.totalTokens}`);
      break;

    case "/clear":
      ctx.setMessages([]);
      break;

    case "/compact":
      addSystemMessage(ctx, "Context compacted.");
      break;

    case "/team":
      await handleTeamCommand(args, ctx);
      break;

    case "/mcp":
      await handleMcpCommand(args, ctx);
      break;

    case "/skill":
      await handleSkillCommand(args, ctx);
      break;

    case "/panel": {
      const layout = arg;
      if (!layout) {
        addSystemMessage(ctx, "Usage: /panel <layout>\nLayouts: auto, horizontal, vertical, grid");
      } else {
        addSystemMessage(ctx, `Panel layout set to: ${layout}`);
      }
      break;
    }

    case "/login":
      await handleLoginSlashCommand(args, ctx);
      break;

    case "/config":
      await handleConfigSlashCommand(args, ctx);
      break;

    case "/launch":
      addSystemMessage(
        ctx,
        `To start the agent orchestrator, exit this chat and run:\n\n` +
        `  ac launch                              Interactive orchestrator REPL\n` +
        `  ac launch --task "Fix the tests"       Single-shot task\n` +
        `  ac launch --visual                     With tmux split-panel view\n` +
        `  ac launch --worker-provider codex      Use Codex as worker\n\n` +
        `The supervisor AI decides when to delegate to workers — no manual setup needed.`,
      );
      break;

    case "/history":
      await handleHistoryCommand(ctx);
      break;

    case "/resume":
      await handleResumeCommand(arg, ctx);
      break;

    case "/quit":
    case "/exit":
      process.exit(0);
      break;

    default:
      addSystemMessage(ctx, `Unknown command: ${command}. Type /help for available commands.`);
  }
}

// ── History & Resume Commands ──────────────────────────────────────────────

async function handleHistoryCommand(ctx: ICommandContext): Promise<void> {
  try {
    const { SqliteStore } = await import("../storage/sqlite-store.js");
    const { ConversationStore } = await import("../storage/conversation-store.js");
    const db = new SqliteStore();
    await db.open();
    const store = new ConversationStore(db);
    // Filter by current project — conversations are project-scoped
    const conversations = store.listConversations(ctx.projectRoot);
    db.close();

    if (conversations.length === 0) {
      addSystemMessage(ctx, "No conversation history for this project.");
      return;
    }

    const lines = conversations.slice(0, 20).map((c, i) => {
      const date = new Date(c.createdAt).toLocaleDateString();
      const model = c.defaultModel ?? "unknown";
      return `  ${String(i + 1).padStart(2)}. ${date}  ${model.padEnd(20)}  ${c.id.slice(0, 8)}\u2026`;
    });
    addSystemMessage(
      ctx,
      `Conversations in this project (${conversations.length} total):\n${lines.join("\n")}\n\nUse /resume <number> or /resume <id> to load.`,
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    addSystemMessage(ctx, `Failed to load history: ${msg}`);
  }
}

async function handleResumeCommand(
  arg: string | undefined,
  ctx: ICommandContext,
): Promise<void> {
  if (!arg) {
    addSystemMessage(ctx, "Usage: /resume <number> or /resume <conversation-id>\nUse /history to see past conversations.");
    return;
  }

  try {
    const { SqliteStore } = await import("../storage/sqlite-store.js");
    const { ConversationStore } = await import("../storage/conversation-store.js");
    const db = new SqliteStore();
    await db.open();
    const store = new ConversationStore(db);

    let conversationId: string;

    // Resolve by number or ID — scoped to current project
    const num = parseInt(arg, 10);
    if (!isNaN(num) && num > 0) {
      const conversations = store.listConversations(ctx.projectRoot);
      const target = conversations[num - 1];
      if (!target) {
        db.close();
        addSystemMessage(ctx, `Conversation #${num} not found. Use /history to see available.`);
        return;
      }
      conversationId = target.id;
    } else {
      // Try as ID prefix — scoped to current project
      const conversations = store.listConversations(ctx.projectRoot);
      const match = conversations.find((c) => c.id.startsWith(arg));
      if (!match) {
        db.close();
        addSystemMessage(ctx, `No conversation matching "${arg}". Use /history to see available.`);
        return;
      }
      conversationId = match.id;
    }

    const storedMessages = store.getMessages(conversationId);
    db.close();

    if (storedMessages.length === 0) {
      addSystemMessage(ctx, "Conversation found but contains no messages.");
      return;
    }

    // Convert stored messages to IChatMessage format
    const restored: IChatMessage[] = storedMessages.map((m) => ({
      id: v4Id(),
      role: m.role as IChatMessage["role"],
      content: m.content,
      model: m.model ?? undefined,
      provider: m.provider as IChatMessage["provider"],
      createdAt: new Date(m.createdAt),
    }));

    ctx.setMessages(restored);
    addSystemMessage(ctx, `Resumed conversation (${restored.length} messages loaded).`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    addSystemMessage(ctx, `Failed to resume: ${msg}`);
  }
}

// ── Conversation Persistence ──────────────────────────────────────────────

/** Lazily-initialized conversation DB reference. */
let convDbRef: { store: InstanceType<typeof import("../storage/conversation-store.js").ConversationStore>; convId: string } | undefined;

async function persistMessages(
  projectRoot: string,
  userMsg: IChatMessage,
  assistantMsg: IChatMessage,
  model: string,
  provider: string,
): Promise<void> {
  try {
    const { SqliteStore } = await import("../storage/sqlite-store.js");
    const { ConversationStore } = await import("../storage/conversation-store.js");

    if (!convDbRef) {
      const db = new SqliteStore();
      await db.open();
      const store = new ConversationStore(db);
      const conv = store.createConversation(projectRoot, model);
      convDbRef = { store, convId: conv.id };
    }

    const { store, convId } = convDbRef;

    store.addMessage({
      conversationId: convId,
      role: "user",
      content: userMsg.content,
    });

    store.addMessage({
      conversationId: convId,
      role: "assistant",
      model,
      provider: provider as import("../types/model.js").ProviderName,
      content: assistantMsg.content,
    });
  } catch {
    // Non-critical — don't break the chat
  }
}

// ── LLM-Driven Dynamic Team Design ───────────────────────────────────────

/**
 * System prompt for the LLM to design an agent team from natural language.
 * The LLM analyzes the user's request and outputs a JSON array of agent specs.
 * Teams are NEVER predefined — every team is dynamically designed by the LLM
 * based on the user's prompt, following the Claude Code agent-team pattern.
 */
const TEAM_DESIGN_SYSTEM_PROMPT =
  "You are an expert team architect for an AI-powered CLI coding tool. " +
  "Your job is to analyze a user's request and design an optimal agent team to accomplish it.\n\n" +
  "You MUST respond with ONLY a JSON array (no markdown, no explanation, no code fences). " +
  "Each element represents one agent with these exact fields:\n" +
  '- "name": string — PascalCase name describing the agent\'s function (e.g. "ProjectManager", "TypeScriptDeveloper", "SecurityAuditor")\n' +
  '- "agentType": string — short role type (e.g. "lead", "developer", "reviewer", "researcher", "designer", "architect", "auditor", "tester")\n' +
  '- "model": string — one of the available models (provided in the user message)\n' +
  '- "role": string — one of: "planning", "coding", "review", "testing", "bugfix", "documentation"\n' +
  '- "taskPrompt": string — detailed, specific instructions for this agent. Include: what to focus on, what files/areas to examine, what deliverables are expected, and what tools to use. This must be tailored to the user\'s actual request, NOT generic.\n\n' +
  "Guidelines for team design:\n" +
  "- Use the MINIMUM number of agents needed to accomplish the task (typically 2-5, max 8)\n" +
  "- Assign the most capable models (opus, gpt-5.2, gemini pro) to critical roles like planning and review\n" +
  "- Assign efficient models (sonnet, haiku, flash) to implementation, testing, and documentation\n" +
  "- Every team MUST have at least one agent with role \"coding\" to do actual implementation\n" +
  "- For complex tasks, include a planner/lead agent and a reviewer agent\n" +
  "- If only one provider's models are available, use those models for all agents\n" +
  "- Each agent's taskPrompt must be highly specific to the user's request — never use generic instructions\n" +
  "- Agent names should reflect their specific responsibility in this task\n";

/** Parsed agent specification from the LLM's team design response. */
interface ILLMAgentSpec {
  readonly name: string;
  readonly agentType: string;
  readonly model: string;
  readonly role: ModelRole;
  readonly taskPrompt: string;
}

const VALID_ROLES: ReadonlySet<string> = new Set([
  "planning", "coding", "review", "testing", "bugfix", "documentation",
]);

/**
 * Parse the LLM's team design response into validated agent specs.
 * Extracts JSON from the response, validates each agent, and falls back
 * to safe defaults for any invalid fields.
 */
function parseLLMTeamDesign(
  response: string,
  availableModels: readonly string[],
  fallbackModel: string,
): ILLMAgentSpec[] {
  let jsonStr = response.trim();

  // Strip markdown code fences if present
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(jsonStr);
  if (fenceMatch?.[1] !== undefined) {
    jsonStr = fenceMatch[1].trim();
  }

  // Find the outermost JSON array
  const arrayStart = jsonStr.indexOf("[");
  const arrayEnd = jsonStr.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) {
    throw new Error("LLM response does not contain a valid JSON array for team design");
  }
  jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse LLM team design as JSON");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("LLM team design must be a non-empty array");
  }

  const availableSet = new Set(availableModels);
  const specs: ILLMAgentSpec[] = [];

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;

    const name = typeof record["name"] === "string" && record["name"].length > 0
      ? record["name"]
      : `Agent${specs.length + 1}`;
    const agentType = typeof record["agentType"] === "string" && record["agentType"].length > 0
      ? record["agentType"]
      : "developer";
    const rawModel = typeof record["model"] === "string" ? record["model"] : "";
    const rawRole = typeof record["role"] === "string" ? record["role"] : "coding";
    const taskPrompt = typeof record["taskPrompt"] === "string" ? record["taskPrompt"] : "";

    const model = availableSet.has(rawModel) ? rawModel : fallbackModel;
    const role = VALID_ROLES.has(rawRole) ? (rawRole as ModelRole) : "coding";

    specs.push({ name, agentType, model, role, taskPrompt });
  }

  if (specs.length === 0) {
    throw new Error("LLM team design produced no valid agent specifications");
  }

  return specs.slice(0, 8);
}

/**
 * Build the user prompt sent to the LLM for team design.
 * Includes the available models list and the user's original request.
 */
function buildTeamDesignUserPrompt(
  userRequest: string,
  availableModels: readonly string[],
): string {
  const modelList = availableModels.map((id) => {
    const info = SUPPORTED_MODELS[id];
    if (!info) return `- ${id}`;
    return `- ${id} (${info.provider}, ${info.name})`;
  }).join("\n");

  return (
    `Available models:\n${modelList}\n\n` +
    `User request:\n${userRequest}\n\n` +
    "Design the agent team. Respond with ONLY a JSON array."
  );
}

// ── Prompt-based Team Creation ────────────────────────────────────────────

const TEAM_CREATION_PATTERNS: readonly RegExp[] = [
  /\bcreate\s+(?:a\s+)?team\b/i,
  /\bstart\s+(?:a\s+)?team\b/i,
  /\bspawn\s+(?:a\s+)?(?:team|agents?|swarm)\b/i,
  /\buse\s+(?:a\s+)?(?:team|swarm|split\s*panel)\b/i,
  /\bassemble\s+(?:a\s+)?team\b/i,
  /\blaunch\s+(?:a\s+)?(?:team|swarm|agents?)\b/i,
  /\bneed\s+(?:a\s+)?(?:team|agents?)\b/i,
  /\bwork\s+(?:as|with)\s+(?:a\s+)?team\b/i,
  /\bmulti[- ]?agent\b/i,
  /\bagent\s+(?:team|swarm)\b/i,
  /\bsplit\s*panel\s*mode\b/i,
  /\bswarm\s+(?:mode|function)\b/i,
  /\bagent\s+(?:orchestrat|coordinat)/i,
  /\busing\s+(?:split\s*panel|agents?|swarm)\b/i,
  /\btest\s+.*\b(?:swarm|team|agents?|split\s*panel)\b/i,
];

function detectTeamCreationIntent(input: string): boolean {
  return TEAM_CREATION_PATTERNS.some((pattern) => pattern.test(input));
}

// ── Module-level active team tracking (for /team stop shutdown) ────────────

let activeTeamManager: TeamManager | undefined;
let activeTeamName: string | undefined;
let activeTmuxCleanup: (() => Promise<void>) | undefined;

// ── Native CLI pane commands ─────────────────────────────────────────────
// Maps provider → native CLI binary for interactive-mode pane sessions.
// Each agent pane runs the native CLI directly (NOT a single-shot adapter)
// so agents have full interactive tool use (read files, write code, etc.)
// — just like Claude Code agent teams.

const PROVIDER_CLI_MAP: Record<string, { bin: string; modelFlag: boolean; extraArgs: readonly string[] }> = {
  anthropic: { bin: "claude", modelFlag: true,  extraArgs: ["--dangerously-skip-permissions"] },
  openai:    { bin: "codex",  modelFlag: true,  extraArgs: ["--sandbox", "danger-full-access", "--ask-for-approval", "never"] },
  google:    { bin: "gemini", modelFlag: true,  extraArgs: ["--yolo"] },
  kimi:      { bin: "kimi",   modelFlag: false, extraArgs: ["--yolo"] },
};

/**
 * Build a launcher shell script for an agent pane.
 * The script `cd`s into the project root, then runs the native CLI in
 * interactive mode with the agent's prompt passed as the initial message.
 * Using a script (vs inline command) ensures `pkill -f` can match by tempDir path.
 */
function writeAgentLauncherScript(
  provider: string,
  model: string,
  promptFile: string,
  launcherFile: string,
  projectRoot: string,
  shellEscapeFn: (s: string) => string,
  writeFileSyncFn: (path: string, data: string, opts?: { mode?: number }) => void,
): string {
  const cliInfo = PROVIDER_CLI_MAP[provider];

  if (cliInfo) {
    const modelArg = cliInfo.modelFlag ? ` --model ${model}` : "";
    const extraArgs = cliInfo.extraArgs.length > 0 ? ` ${cliInfo.extraArgs.join(" ")}` : "";
    // Do NOT use `exec` — bash must remain as parent so `pkill -f` can match
    // the launcher script path in tempDir for /team stop cleanup.
    const script = [
      "#!/bin/bash",
      `cd '${shellEscapeFn(projectRoot)}' || exit 1`,
      `${cliInfo.bin}${extraArgs}${modelArg} "$(cat '${shellEscapeFn(promptFile)}')"`,
    ].join("\n");
    writeFileSyncFn(launcherFile, script, { mode: 0o755 });
    return `bash '${shellEscapeFn(launcherFile)}'`;
  }

  // Fallback: run AemeathCLI wrapper (for ollama or unknown providers)
  const script = [
    "#!/bin/bash",
    `cd '${shellEscapeFn(projectRoot)}' || exit 1`,
    `export AEMEATHCLI_PROMPT_FILE='${shellEscapeFn(promptFile)}'`,
    `'${shellEscapeFn(process.execPath)}' '${shellEscapeFn(process.argv[1] ?? "aemeathcli")}' --model ${model}`,
  ].join("\n");
  writeFileSyncFn(launcherFile, script, { mode: 0o755 });
  return `bash '${shellEscapeFn(launcherFile)}'`;
}

async function handlePromptBasedTeamCreation(
  input: string,
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>,
  panel: {
    readonly isSplitPanelActive: boolean;
    readonly setAgents: (agents: readonly IAgentState[]) => void;
    readonly activate: () => void;
    readonly appendOutput: (agentId: string, content: string) => void;
    readonly updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  },
  getRegistry: () => Promise<ProviderRegistry>,
  currentModelId: string,
): Promise<string | undefined> {
  const teamName = `team-${Date.now()}`;

  setMessages((prev) => [
    ...prev,
    { id: v4Id(), role: "user" as const, content: input, createdAt: new Date() },
    {
      id: v4Id(),
      role: "system" as const,
      content: "Analyzing your request to design the agent team...",
      createdAt: new Date(),
    },
  ]);

  try {
    // 1. Detect installed CLIs to determine available models for team agents.
    // This uses actual CLI binary detection (not API keys) so agents can use
    // any installed CLI tool: claude, codex, gemini, kimi, ollama.
    const registry = await getRegistry();
    const { detectInstalledProviders } = await import("../orchestrator/utils/detect-providers.js");
    const installedClis = detectInstalledProviders();

    // Map CLI provider types to SUPPORTED_MODELS provider names
    const cliToProvider: Record<string, string> = {
      "claude-code": "anthropic",
      "codex": "openai",
      "gemini-cli": "google",
      "kimi-cli": "kimi",
      "ollama": "ollama",
    };
    const installedProviderNames = new Set(
      installedClis.map((cli) => cliToProvider[cli]).filter(Boolean),
    );

    // All models from installed providers are available for team agents
    const availableModels = Object.keys(SUPPORTED_MODELS).filter((id) => {
      const info = SUPPORTED_MODELS[id];
      return info !== undefined && installedProviderNames.has(info.provider);
    });

    if (availableModels.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: v4Id(),
          role: "system" as const,
          content:
            "No AI CLI tools detected. Install at least one: claude, codex, gemini, kimi, or ollama.",
          createdAt: new Date(),
        },
      ]);
      return;
    }

    // 2. Use the current model to design the team via LLM
    const [firstAvailableModel] = availableModels;
    if (firstAvailableModel === undefined) {
      return;
    }
    const designModel = registry.hasModel(currentModelId)
      ? currentModelId
      : firstAvailableModel;
    const designProvider = registry.getForModel(designModel);
    const userPrompt = buildTeamDesignUserPrompt(input, availableModels);

    const designStream = designProvider.stream({
      model: designModel,
      messages: [
        {
          id: v4Id(),
          role: "user" as const,
          content: userPrompt,
          createdAt: new Date(),
        },
      ],
      system: TEAM_DESIGN_SYSTEM_PROMPT,
      maxTokens: 4000,
    });

    let designResponse = "";
    for await (const chunk of designStream) {
      if (chunk.type === "text" && chunk.content) {
        designResponse += chunk.content;
      }
    }

    // 3. Parse the LLM's team design
    const agentSpecs = parseLLMTeamDesign(
      designResponse,
      availableModels,
      designModel,
    );

    // 4. Map parsed specs to IAgentDefinition for TeamManager
    const agentDefinitions = agentSpecs.map((spec) => {
      const modelInfo = SUPPORTED_MODELS[spec.model];
      const provider: ProviderName = modelInfo?.provider ?? "anthropic";
      return {
        name: spec.name,
        agentType: spec.agentType,
        model: spec.model,
        provider,
        role: spec.role,
      };
    });

    // 5. Prepare shared resources for split-panel mode (hub-and-spoke coordination)
    // Board directory is inside the project so native CLIs (claude, codex, gemini)
    // can read/write to it — they scope file access to the current working directory.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const { execa: execaPane } = await import("execa");

    const boardDir = path.join(process.cwd(), ".aemeathcli", "team-board");
    fs.mkdirSync(boardDir, { recursive: true });
    // Temp dir for prompt files and manifest (not accessed by native CLIs)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aemeathcli-team-"));

    const shellEscape = (s: string): string => s.replace(/'/gu, "'\\''");

    // Identify the lead agent (first agent with "lead" type, or first "planning" role)
    const [firstAgentSpec] = agentSpecs;
    if (firstAgentSpec === undefined) {
      return;
    }
    const leadSpec = agentSpecs.find((s) => s.agentType === "lead")
      ?? agentSpecs.find((s) => s.role === "planning")
      ?? firstAgentSpec;

    // Write team manifest to shared workspace (readable by all agents)
    const teamManifest = {
      teamName,
      task: input,
      boardDir,
      leadAgent: leadSpec.name,
      agents: agentSpecs.map((s) => ({
        name: s.name,
        agentType: s.agentType,
        model: s.model,
        role: s.role,
        outputFile: path.join(boardDir, `${s.name}.md`),
      })),
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(boardDir, "team-manifest.json"),
      JSON.stringify(teamManifest, null, 2),
      "utf-8",
    );

    // Build team roster string for inclusion in every agent's prompt
    const teamRoster = agentSpecs
      .map((s) => `  - ${s.name} (${s.agentType}, ${s.model}) — role: ${s.role}`)
      .join("\n");

    // Separate the lead agent from worker agents.
    // Worker agents get their own split panes running native CLIs in interactive mode.
    // The lead agent's task is auto-submitted in the current AemeathCLI pane so the
    // left pane actively coordinates (matching Claude Code's agent team model).
    const workerSpecs = agentSpecs.filter((s) => s.name !== leadSpec.name);
    const projectRoot = process.cwd();

    // Write prompt files with full team context and coordination protocol
    const agentCommands: Array<{ name: string; command: string }> = [];
    for (const spec of [...workerSpecs]) {
      const outputFile = path.join(boardDir, `${spec.name}.md`);
      const promptFile = path.join(tempDir, `${spec.name}.txt`);

      const prompt = [
        `# Team Role: ${spec.name}`,
        `Type: ${spec.agentType} | Model: ${spec.model} | Role: ${spec.role}`,
        "",
        "## Your Task",
        spec.taskPrompt,
        "",
        "## Team Context",
        `You are part of a ${agentSpecs.length}-agent team working collaboratively.`,
        `Each agent has a specific domain. Do NOT overlap with other agents' responsibilities.`,
        "",
        "### Team Members:",
        teamRoster,
        "",
        "## Shared Workspace",
        `Team board directory: ${boardDir}`,
        `Your output file: ${outputFile}`,
        `Team manifest: ${path.join(boardDir, "team-manifest.json")}`,
        "",
        "## Coordination Protocol",
        `1. Write ALL your findings, analysis, and deliverables to your output file: ${outputFile}`,
        `2. You can read other agents' output files in ${boardDir}/ to check their progress and avoid duplication.`,
        `3. Focus on YOUR specific domain. Reference other agents' work when relevant to your analysis.`,
        `4. Read and analyze source files in the project directory to complete your task.`,
        `5. Be thorough and specific. Include file paths, line numbers, and code snippets in your findings.`,
        "",
        "## Coordination with Lead",
        `The team lead is ${leadSpec.name}. Check their coordination plan at: ${path.join(boardDir, "coordinator.md")}`,
        `After completing your work, the lead agent will read your output and synthesize findings.`,
        "",
        "## User's Original Request",
        input,
      ].join("\n");

      fs.writeFileSync(promptFile, prompt, "utf-8");

      // Each agent pane runs the native CLI directly in interactive mode
      // (claude, codex, gemini, kimi) instead of wrapping through AemeathCLI's
      // single-shot adapter. This gives agents full tool use for reading files,
      // writing code, running commands, etc. — matching Claude Code agent teams.
      const modelInfo = SUPPORTED_MODELS[spec.model];
      const provider = modelInfo?.provider ?? "anthropic";
      const launcherFile = path.join(tempDir, `${spec.name}-launch.sh`);
      const cmd = writeAgentLauncherScript(
        provider, spec.model, promptFile, launcherFile,
        projectRoot, shellEscape, fs.writeFileSync,
      );
      agentCommands.push({ name: spec.name, command: cmd });
    }

    // Build the lead agent's coordination task for auto-submission in the left pane.
    // The leader actively works (not idle) — it coordinates, analyzes, and synthesizes.
    const leadOutputFile = path.join(boardDir, `${leadSpec.name}.md`);
    const leadCoordinationTask = [
      `I am the team coordinator (${leadSpec.name}, ${leadSpec.model}).`,
      "",
      leadSpec.taskPrompt,
      "",
      `## My Responsibilities`,
      `1. Break down the user's request into clear subtasks for each team member.`,
      `2. Write my coordination plan and task assignments to: ${path.join(boardDir, "coordinator.md")}`,
      `3. After completing my own analysis, read other agents' output files in ${boardDir}/ to check progress.`,
      `4. Synthesize findings from all agents into a final team summary at: ${path.join(boardDir, "SUMMARY.md")}`,
      `5. Flag any conflicts, gaps, or overlaps between agents' work.`,
      "",
      `## Team Members Working in Parallel Panes`,
      ...workerSpecs.map((s) => `- ${s.name} (${s.model}): writing to ${path.join(boardDir, s.name + ".md")}`),
      "",
      `## My Output File: ${leadOutputFile}`,
      "",
      `## User's Original Request`,
      input,
      "",
      `Start by reading the codebase and writing my coordination plan to ${path.join(boardDir, "coordinator.md")}.`,
    ].join("\n");

    // 6. iTerm2 native pane support (macOS — preferred when in iTerm2)
    const isITerm2 =
      process.platform === "darwin" &&
      process.env["TERM_PROGRAM"] === "iTerm.app";

    if (isITerm2) {
      setMessages((prev) => [
        ...prev,
        {
          id: v4Id(),
          role: "system" as const,
          content: `Designed ${agentSpecs.length}-agent team. Creating iTerm2 split panes...`,
          createdAt: new Date(),
        },
      ]);

      // Build AppleScript: leader stays in current pane (left side),
      // agents are created via vertical then horizontal splits (right side).
      // Layout: leader (left) | agents stacked vertically (right)
      const asEscape = (s: string): string =>
        s.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');

      const scriptLines: string[] = [];
      scriptLines.push('tell application "iTerm2"');
      scriptLines.push("  tell current window");
      scriptLines.push("    set leaderSession to current session of current tab");

      for (const [i, agent] of agentCommands.entries()) {
        const prevVar = i === 0 ? "leaderSession" : `agent${i - 1}`;
        const curVar = `agent${i}`;
        // First agent: split leader vertically (creates right column)
        // Subsequent agents: split previous agent horizontally (stacks on right)
        const splitDir = i === 0 ? "vertically" : "horizontally";
        const splitTarget = prevVar;

        const escapedName = asEscape(agent.name);
        const escapedCmd = asEscape(agent.command);

        scriptLines.push(`    tell ${splitTarget}`);
        scriptLines.push(`      set ${curVar} to (split ${splitDir} with default profile)`);
        scriptLines.push("    end tell");
        scriptLines.push(`    tell ${curVar}`);
        scriptLines.push(`      set name to "${escapedName}"`);
        scriptLines.push(`      write text "${escapedCmd}"`);
        scriptLines.push("    end tell");
      }

      scriptLines.push("    select leaderSession");
      scriptLines.push("  end tell");
      scriptLines.push("end tell");

      const script = scriptLines.join("\n");
      const scriptFile = path.join(tempDir, "create-panes.applescript");
      fs.writeFileSync(scriptFile, script, "utf-8");

      try {
        await execaPane("osascript", [scriptFile]);
      } catch (scriptErr: unknown) {
        const errMsg = scriptErr instanceof Error ? scriptErr.message : String(scriptErr);
        setMessages((prev) => [
          ...prev,
          {
            id: v4Id(),
            role: "system" as const,
            content: `Failed to create iTerm2 panes: ${errMsg.slice(0, 200)}`,
            createdAt: new Date(),
          },
        ]);
        return;
      }

      // Store cleanup for /team stop
      activeTeamName = teamName;
      activeTeamManager = undefined;
      activeTmuxCleanup = async () => {
        // Kill agent processes identified by temp dir in their arguments
        try {
          const { execSync } = await import("node:child_process");
          execSync(`pkill -f '${shellEscape(tempDir)}'`, { stdio: "ignore" });
        } catch { /* no matching processes */ }
        // Clean up temp files and board directory
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          fs.rmSync(boardDir, { recursive: true, force: true });
        } catch { /* non-critical */ }
      };

      const agentLines = agentSpecs.map(
        (spec) =>
          spec.name === leadSpec.name
            ? `  ${spec.name} (${spec.model}) — ${spec.role} [LEAD — this pane]`
            : `  ${spec.name} (${spec.model}) — ${spec.role}`,
      );
      setMessages((prev) => [
        ...prev,
        {
          id: v4Id(),
          role: "system" as const,
          content:
            `Team "${teamName}" — ${agentSpecs.length} agents active.\n` +
            `${workerSpecs.length} worker panes in iTerm2 + lead coordinating here.\n` +
            `${agentLines.join("\n")}\n` +
            "/team stop to shut down all agents.",
          createdAt: new Date(),
        },
      ]);
      return leadCoordinationTask;
    }

    // 7. tmux-based split-panel mode (fallback when not in iTerm2)
    const { TmuxManager } = await import("../panes/tmux-manager.js");
    const tmux = new TmuxManager();
    const tmuxAvailable = await tmux.isAvailable();

    if (tmuxAvailable) {
      const insideTmux =
        typeof process.env["TMUX"] === "string" &&
        process.env["TMUX"].length > 0;

      if (insideTmux) {
        // ── Already inside tmux — split current window directly ──
        setMessages((prev) => [
          ...prev,
          {
            id: v4Id(),
            role: "system" as const,
            content: `Designed ${agentSpecs.length}-agent team. Creating tmux split panes...`,
            createdAt: new Date(),
          },
        ]);

        const currentResult = await execaPane("tmux", [
          "display-message", "-p", "#{pane_id}",
        ]);
        const leaderPaneId = currentResult.stdout.trim();
        const agentPaneIds: string[] = [];

        for (const [i, agent] of agentCommands.entries()) {
          const splitResult = await execaPane("tmux", [
            "split-window",
            i % 2 === 0 ? "-h" : "-v",
            "-P", "-F", "#{pane_id}",
          ]);
          const newPaneId = splitResult.stdout.trim();
          agentPaneIds.push(newPaneId);
          await execaPane("tmux", ["send-keys", "-t", newPaneId, agent.command, "Enter"]);
        }

        try {
          await execaPane("tmux", ["select-layout", "tiled"]);
        } catch { /* non-fatal */ }
        try {
          await execaPane("tmux", ["select-pane", "-t", leaderPaneId]);
        } catch { /* non-fatal */ }

        activeTeamName = teamName;
        activeTeamManager = undefined;
        activeTmuxCleanup = async () => {
          const { execa: ex } = await import("execa");
          for (const pid of agentPaneIds) {
            try { await ex("tmux", ["kill-pane", "-t", pid]); } catch { /* pane may be gone */ }
          }
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
            fs.rmSync(boardDir, { recursive: true, force: true });
          } catch { /* non-critical */ }
        };

        const agentLines = agentSpecs.map(
          (spec) =>
            spec.name === leadSpec.name
              ? `  ${spec.name} (${spec.model}) — ${spec.role} [LEAD — this pane]`
              : `  ${spec.name} (${spec.model}) — ${spec.role}`,
        );
        setMessages((prev) => [
          ...prev,
          {
            id: v4Id(),
            role: "system" as const,
            content:
              `Team "${teamName}" — ${agentSpecs.length} agents active.\n` +
              `${workerSpecs.length} worker panes in tmux + lead coordinating here.\n` +
              `${agentLines.join("\n")}\n` +
              "/team stop to shut down all agents.",
            createdAt: new Date(),
          },
        ]);
        return leadCoordinationTask;
      }

      // ── Not inside tmux — create session, populate, and auto-attach ──
      setMessages((prev) => [
        ...prev,
        {
          id: v4Id(),
          role: "system" as const,
          content: `Designed ${agentSpecs.length}-agent team. Opening tmux split-panel view...`,
          createdAt: new Date(),
        },
      ]);

      const sessionName = await tmux.createSession(teamName);

      const paneConfigs: IPaneConfig[] = agentSpecs.map((spec, i) => ({
        paneId: `pane-${i}`,
        agentName: spec.name,
        model: spec.model,
        role: spec.role,
        title: `${spec.name} (${spec.model})`,
      }));

      const layoutConfig: ILayoutConfig = {
        layout: "auto" as PaneLayout,
        panes: paneConfigs,
        maxPanes: paneConfigs.length,
      };

      await tmux.createPanes(layoutConfig);

      for (const [i, agent] of agentCommands.entries()) {
        const paneId = `pane-${i}`;
        await tmux.sendCommand(paneId, agent.command);
      }

      activeTeamName = teamName;
      activeTeamManager = undefined;
      activeTmuxCleanup = async () => {
        await tmux.destroy();
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          fs.rmSync(boardDir, { recursive: true, force: true });
        } catch { /* non-critical */ }
      };

      // Show pre-attach hint
      setMessages((prev) => [
        ...prev,
        {
          id: v4Id(),
          role: "system" as const,
          content:
            `Attaching to tmux session "${sessionName}" with ${agentSpecs.length} agents\u2026\n\n` +
            `Inside tmux:\n` +
            `  Ctrl+B \u2192/\u2190/\u2191/\u2193   Switch pane\n` +
            `  Ctrl+B  d            Detach (return to aemeath)\n` +
            `  Ctrl+B  z            Zoom pane fullscreen`,
          createdAt: new Date(),
        },
      ]);

      // Auto-attach: temporarily release terminal from Ink, hand it to tmux.
      const { execFileSync } = await import("node:child_process");

      if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();

      try {
        execFileSync("tmux", ["attach-session", "-t", sessionName], {
          stdio: "inherit",
        });
      } catch {
        // User detached from tmux or attach failed
      }

      if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const agentLines = agentSpecs.map(
        (spec) =>
          spec.name === leadSpec.name
            ? `  ${spec.name} (${spec.model}) — ${spec.role} [LEAD]`
            : `  ${spec.name} (${spec.model}) — ${spec.role}`,
      );
      setMessages((prev) => [
        ...prev,
        {
          id: v4Id(),
          role: "system" as const,
          content:
            `Detached from tmux. Agents may still be running.\n\n` +
            `Agents:\n${agentLines.join("\n")}\n\n` +
            `Keybindings (inside tmux):\n` +
            `  Ctrl+B \u2192 \u2190 \u2191 \u2193   Switch between panes\n` +
            `  Ctrl+B  d            Detach (return here)\n` +
            `  Ctrl+B  z            Zoom active pane (fullscreen toggle)\n` +
            `  Ctrl+B  x            Close active pane\n\n` +
            `Re-attach:  tmux attach -t ${sessionName}\n` +
            `/team stop  Shut down all agents and kill session`,
          createdAt: new Date(),
        },
      ]);
      return leadCoordinationTask;
    }

    // ── Fallback: in-process split-panel mode (when tmux unavailable) ──
    setMessages((prev) => [
      ...prev,
      {
        id: v4Id(),
        role: "system" as const,
        content:
          `Designed ${agentSpecs.length}-agent team. Starting agents (in-process mode)\u2026\n\n` +
          `Keybindings:\n` +
          `  Tab              Switch to next agent\n` +
          `  Ctrl+1-${agentSpecs.length}          Jump to agent N\n` +
          `  /team stop       Exit team mode`,
        createdAt: new Date(),
      },
    ]);

    const { TeamManager: TM } = await import("../teams/team-manager.js");
    const manager = new TM();
    activeTeamManager = manager;
    activeTeamName = teamName;
    activeTmuxCleanup = undefined;

    const teamConfig = manager.createTeam(teamName, {
      description: `Agent team for: ${input.slice(0, 120)}`,
      agents: agentDefinitions,
    });

    // Initialize split-panel UI
    const agentStates: IAgentState[] = teamConfig.members.map((member) => ({
      config: member,
      status: "idle" as const,
    }));

    panel.setAgents(agentStates);
    panel.activate();

    for (const member of teamConfig.members) {
      panel.appendOutput(
        member.agentId,
        `[${member.name}] Starting (${member.model})...\n`,
      );
    }

    // Wire agent IPC output to the panel UI BEFORE starting agents
    manager.onAgentMessages(teamName, (_agentName, method, params) => {
      if (method === "agent.streamChunk") {
        const agentId =
          typeof params["agentId"] === "string" ? params["agentId"] : "";
        const content =
          typeof params["content"] === "string" ? params["content"] : "";
        if (agentId && content) {
          panel.appendOutput(agentId, content);
        }
      }
      if (method === "agent.taskUpdate") {
        const agentId =
          typeof params["agentId"] === "string" ? params["agentId"] : "";
        const rawStatus =
          typeof params["status"] === "string" ? params["status"] : "";
        if (agentId && rawStatus) {
          const statusMap: Record<string, AgentStatus> = {
            in_progress: "active",
            completed: "idle",
          };
          const mapped = statusMap[rawStatus];
          if (mapped) {
            panel.updateAgentStatus(agentId, mapped);
          }
        }
      }
    });

    await manager.startAgents(teamName);

    // Assign tasks — use LLM-generated taskPrompt for each agent
    for (const [i, member] of teamConfig.members.entries()) {
      const spec = agentSpecs[i];
      const taskId = v4Id();
      const prompt = spec
        ? `You are ${spec.name} (${spec.agentType}).\n\n${spec.taskPrompt}\n\nUser request:\n${input}`
        : `Work on the following task:\n\n${input}`;
      manager.assignTask(
        teamName,
        member.name,
        taskId,
        `${member.role}: ${input.slice(0, 80)}`,
        prompt,
      );
    }

    // Show success message
    const agentLines = agentSpecs.map(
      (spec) => `  ${spec.name} (${spec.model}) — ${spec.role}`,
    );
    setMessages((prev) => [
      ...prev,
      {
        id: v4Id(),
        role: "system" as const,
        content:
          `Team "${teamName}" created with ${teamConfig.members.length} agents — split-panel active.\n` +
          `${agentLines.join("\n")}\n` +
          "Use Tab to switch agents. /team stop to return to single-pane.",
        createdAt: new Date(),
      },
    ]);
    return undefined;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    setMessages((prev) => [
      ...prev,
      {
        id: v4Id(),
        role: "system" as const,
        content: `Failed to create team: ${msg}`,
        createdAt: new Date(),
      },
    ]);
    return undefined;
  }
}

async function handleTeamCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "stop") {
    // Gracefully shut down tmux session if active
    if (activeTmuxCleanup) {
      try {
        await activeTmuxCleanup();
      } catch {
        // Best-effort cleanup — tmux session may already be gone
      }
      activeTmuxCleanup = undefined;
    }

    // Gracefully shut down all in-process agent processes
    if (activeTeamManager && activeTeamName) {
      try {
        await activeTeamManager.deleteTeam(activeTeamName);
      } catch {
        // Best-effort cleanup — processes may already be gone
      }
      activeTeamManager = undefined;
    }

    activeTeamName = undefined;
    ctx.panel.deactivate();
    addSystemMessage(ctx, "Team shut down. All agents stopped. Returned to single-pane mode.");
    return;
  }

  if (subcommand === "list") {
    try {
      const { TeamManager } = await import("../teams/team-manager.js");
      const manager = new TeamManager();
      const teams = manager.listTeams();
      if (teams.length === 0) {
        addSystemMessage(ctx, "No active teams.");
      } else {
        const lines = teams.map((t) => `  ${t.teamName} — ${t.members.length} agents (${t.status})`);
        addSystemMessage(ctx, lines.join("\n"));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to list teams: ${msg}`);
    }
    return;
  }

  addSystemMessage(
    ctx,
    "Usage: /team list | /team stop\n" +
    "Teams are created automatically from natural language.\n" +
    "Examples: \"Create a team to refactor the auth module\"\n" +
    "          \"I need agents to review this PR from different angles\"",
  );
}

// ── MCP Command Handler ───────────────────────────────────────────────────

async function handleMcpCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "list") {
    try {
      const { MCPServerManager } = await import("../mcp/server-manager.js");
      const manager = new MCPServerManager();
      const connected = manager.getConnectedServers();
      if (connected.length === 0) {
        addSystemMessage(ctx, "No MCP servers connected.\nConfigure servers in ~/.aemeathcli/mcp.json");
      } else {
        const lines = connected.map((name) => {
          const status = manager.getServerStatus(name) ?? "unknown";
          return `  ${name} — ${status}`;
        });
        addSystemMessage(ctx, `MCP Servers:\n${lines.join("\n")}`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to list MCP servers: ${msg}`);
    }
    return;
  }

  if (subcommand === "add") {
    const name = args[1];
    if (!name) {
      addSystemMessage(ctx, "Usage: /mcp add <server-name>");
      return;
    }
    addSystemMessage(ctx, `To add MCP server "${name}", edit ~/.aemeathcli/mcp.json with the server configuration.`);
    return;
  }

  addSystemMessage(ctx, "Usage: /mcp list | /mcp add <name>");
}

// ── Skill Command Handler ────────────────────────────────────────────────

async function handleSkillCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "list") {
    try {
      const { SkillRegistry } = await import("../skills/registry.js");
      const { findProjectRoot } = await import("../utils/pathResolver.js");
      const registry = new SkillRegistry();
      await registry.initialize(findProjectRoot());
      const skills = registry.listAll();
      if (skills.length === 0) {
        addSystemMessage(ctx, "No skills found.\nAdd skills in ~/.agents/skills/, ~/.aemeathcli/skills/, .agents/skills/, or .aemeathcli/skills/");
      } else {
        const lines = skills.map((s) => `  $${s.name.padEnd(16)} ${s.description}  [${s.source}]`);
        addSystemMessage(ctx, `Available Skills:\n${lines.join("\n")}`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to list skills: ${msg}`);
    }
    return;
  }

  addSystemMessage(ctx, "Usage: /skill list\nInvoke a skill with $skill-name (e.g., $review, $commit, $plan)");
}

// ── Login Slash Command Handler ──────────────────────────────────────────

async function handleLoginSlashCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "status") {
    try {
      const providers = ["claude", "codex", "gemini", "kimi"] as const;
      const lines: string[] = [];
      for (const provider of providers) {
        try {
          const loginMod = await loadLoginModuleForSlash(provider);
          const status = await loginMod.getStatus();
          if (status.loggedIn) {
            lines.push(`  \u2713 ${provider} — Logged in as ${status.email ?? "unknown"} (${status.plan ?? "unknown plan"})`);
          } else {
            lines.push(`  \u2717 ${provider} — Not logged in`);
          }
        } catch {
          lines.push(`  \u2717 ${provider} — Not configured`);
        }
      }
      addSystemMessage(ctx, lines.join("\n"));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to get auth status: ${msg}`);
    }
    return;
  }

  if (subcommand === "logout") {
    const provider = args[1];
    if (!provider) {
      addSystemMessage(ctx, "Usage: /login logout <provider>\nProviders: claude, codex, gemini, kimi");
      return;
    }
    try {
      const loginMod = await loadLoginModuleForSlash(provider as "claude" | "codex" | "gemini" | "kimi");
      await loginMod.logout();
      addSystemMessage(ctx, `Logged out of ${provider}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Logout failed: ${msg}`);
    }
    return;
  }

  // No subcommand → open interactive provider selector
  ctx.setSelectionMode({ type: "login" });
}

interface ISlashLoginModule {
  login(): Promise<unknown>;
  logout(): Promise<void>;
  getStatus(): Promise<{ loggedIn: boolean; email?: string | undefined; plan?: string | undefined }>;
}

async function loadLoginModuleForSlash(provider: string): Promise<ISlashLoginModule> {
  switch (provider) {
    case "claude": {
      const mod = await import("../auth/providers/claude-login.js");
      return new mod.ClaudeLogin();
    }
    case "codex": {
      const mod = await import("../auth/providers/codex-login.js");
      return new mod.CodexLogin();
    }
    case "gemini": {
      const mod = await import("../auth/providers/gemini-login.js");
      return new mod.GeminiLogin();
    }
    case "kimi": {
      const mod = await import("../auth/providers/kimi-login.js");
      return new mod.KimiLogin();
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Config Slash Command Handler ─────────────────────────────────────────

async function handleConfigSlashCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "get") {
    const key = args[1];
    try {
      const { ConfigStore } = await import("../storage/config-store.js");
      const store = new ConfigStore();
      const cfg = store.loadGlobal();
      if (!key) {
        addSystemMessage(ctx, JSON.stringify(cfg, null, 2));
      } else {
        const value = getNestedConfigValue(cfg, key);
        if (value === undefined) {
          addSystemMessage(ctx, `Key not found: ${key}`);
        } else {
          addSystemMessage(ctx, `${key} = ${JSON.stringify(value, null, 2)}`);
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to read config: ${msg}`);
    }
    return;
  }

  if (subcommand === "set") {
    const key = args[1];
    const value = args.slice(2).join(" ");
    if (!key || !value) {
      addSystemMessage(ctx, "Usage: /config set <key> <value>");
      return;
    }
    try {
      const { ConfigStore } = await import("../storage/config-store.js");
      const store = new ConfigStore();
      const cfg = store.loadGlobal();
      let parsedValue: unknown;
      try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
      setNestedConfigValue(cfg as unknown as Record<string, unknown>, key, parsedValue);
      store.saveGlobal(cfg);
      addSystemMessage(ctx, `Set ${key} = ${JSON.stringify(parsedValue)}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to set config: ${msg}`);
    }
    return;
  }

  addSystemMessage(ctx, "Usage: /config get [key] | /config set <key> <value>");
}

function getNestedConfigValue(obj: unknown, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedConfigValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!key) continue;
    if (typeof current[key] !== "object" || current[key] === null) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  if (lastKey) current[lastKey] = value;
}

// ── Skill Invocation Handler ($) ─────────────────────────────────────────

async function handleSkillInvocation(
  input: string,
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>,
): Promise<void> {
  const parts = input.trim().split(/\s+/);
  const trigger = parts[0] ?? "";
  const skillName = trigger.replace(/^\$/, "");

  if (!skillName) {
    setMessages((prev) => [
      ...prev,
      { id: v4Id(), role: "system" as const, content: "Usage: $skill-name [args]\nType /skill list to see available skills.", createdAt: new Date() },
    ]);
    return;
  }

  setMessages((prev) => [
    ...prev,
    { id: v4Id(), role: "user" as const, content: input, createdAt: new Date() },
  ]);

  try {
    const { SkillRegistry } = await import("../skills/registry.js");
    const { SkillExecutor } = await import("../skills/executor.js");
    const { findProjectRoot } = await import("../utils/pathResolver.js");
    const registry = new SkillRegistry();
    await registry.initialize(findProjectRoot());

    const executor = new SkillExecutor(registry);
    const result = await executor.activateByTrigger(trigger);

    if (!result.success) {
      setMessages((prev) => [
        ...prev,
        { id: v4Id(), role: "system" as const, content: result.errorMessage ?? `Skill not found: "${skillName}"\nType /skill list to see available skills.`, createdAt: new Date() },
      ]);
      return;
    }

    const content = executor.getActiveSkillContent();
    const warningText = result.warnings && result.warnings.length > 0
      ? `\nWarnings: ${result.warnings.join(", ")}`
      : "";
    setMessages((prev) => [
      ...prev,
      { id: v4Id(), role: "system" as const, content: `Skill "$${skillName}" activated.${warningText}\n${content ? content.slice(0, 500) : ""}`, createdAt: new Date() },
    ]);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    setMessages((prev) => [
      ...prev,
      { id: v4Id(), role: "system" as const, content: `Skill error: ${msg}`, createdAt: new Date() },
    ]);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export async function startChatSession(options: IChatSessionOptions): Promise<void> {
  let config: IGlobalConfig;

  try {
    const { ConfigStore } = await import("../storage/config-store.js");
    const store = new ConfigStore();
    config = store.loadGlobal();
  } catch {
    config = DEFAULT_CONFIG;
  }

  const { waitUntilExit } = render(<App config={config} options={options} />);
  await waitUntilExit();
}

export async function runFirstRunSetup(): Promise<void> {
  const { runFirstRunSetup: runCliFirstRunSetup } = await import("../cli/setup/first-run.js");
  await runCliFirstRunSetup();
}
