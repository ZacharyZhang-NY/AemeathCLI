/**
 * Root TUI application component per PRD section 6.2
 * Orchestrates the entire interactive chat experience
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { render, Box, Text } from "ink";
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
  ProviderName,
  IModelResolution,
} from "../types/index.js";
import { DEFAULT_CONFIG, SUPPORTED_MODELS } from "../types/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { v4Id } from "./utils.js";
import { SLASH_COMMANDS } from "./autocomplete-data.js";

interface IChatSessionOptions {
  readonly initialMessage?: string | undefined;
  readonly model?: string | undefined;
  readonly role?: string | undefined;
  readonly systemPrompt?: string | undefined;
  readonly streaming?: boolean | undefined;
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

function App({ config, options }: IAppProps): React.ReactElement {
  const { resolution, modelId, switchModel, switchRole } = useModel(
    config,
    options.model,
    options.role as ModelRole | undefined,
  );
  const { state: streamState, startStream, cancelStream, reset: resetStream } = useStream();
  const { totalCost, totalTokens, record } = useCost(config.cost);
  const panel = usePanel();

  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [gitBranch, setGitBranch] = useState<string | undefined>();

  // Cached provider registry — initialized lazily on first use
  const registryRef = useRef<ProviderRegistry | undefined>(undefined);

  const getRegistry = useCallback(async (): Promise<ProviderRegistry> => {
    if (registryRef.current !== undefined) return registryRef.current;
    const { createDefaultRegistry } = await import("../providers/registry.js");
    registryRef.current = await createDefaultRegistry();
    return registryRef.current;
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

  // Handle initial message
  useEffect(() => {
    if (options.initialMessage) {
      handleSubmit(options.initialMessage);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(
    async (input: string) => {
      // Handle internal commands
      if (input.startsWith("/")) {
        await handleInternalCommand(input, switchModel, switchRole, {
          totalCost,
          totalTokens,
          setMessages,
          modelId,
          resolution,
          panel: {
            setAgents: panel.setAgents,
            activate: panel.activate,
            deactivate: panel.deactivate,
            appendOutput: panel.appendOutput,
          },
          getRegistry,
        });
        return;
      }

      const userMessage: IChatMessage = {
        id: v4Id(),
        role: "user",
        content: input,
        createdAt: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsProcessing(true);

      try {
        const registry = await getRegistry();
        const allMessages = [...messages, userMessage];
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
            system: options.systemPrompt,
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
          throw (lastError ?? new Error("No model could produce a response"));
        }

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
      messages,
      modelId,
      resolution,
      options.systemPrompt,
      record,
      switchModel,
      switchRole,
      startStream,
      resetStream,
      getRegistry,
    ],
  );

  if (panel.isSplitPanelActive) {
    return (
      <SplitPane
        agents={panel.agents}
        activeAgentIndex={panel.activeAgentIndex}
        onSelectAgent={panel.selectAgent}
        agentOutputs={panel.agentOutputs}
        isProcessing={isProcessing}
        onSubmit={handleSubmit}
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
      onSubmit={handleSubmit}
      model={modelId}
      role={resolution.role}
      tokenCount={totalTokens}
      cost={totalCost}
      gitBranch={gitBranch}
      streamingContent={streamState.content}
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
  readonly resolution: { readonly provider: string; readonly role?: string | undefined };
  readonly panel: IPanelControls;
  readonly getRegistry: () => Promise<ProviderRegistry>;
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

async function handleInternalCommand(
  input: string,
  switchModel: (model: string) => void,
  switchRole: (role: ModelRole) => void,
  ctx: ICommandContext,
): Promise<void> {
  const parts = input.trim().split(/\s+/);
  const command = parts[0];
  const arg = parts[1];

  switch (command) {
    case "/help": {
      const helpLines = SLASH_COMMANDS.map((cmd) => `  ${cmd.command.padEnd(17)}${cmd.description}`).join("\n");
      addSystemMessage(ctx, helpLines);
      break;
    }

    case "/model": {
      if (arg === "list") {
        try {
          const registry = await ctx.getRegistry();
          const available = await registry.listAllAvailableModels();
          const lines: string[] = [];

          for (const [providerName, modelIds] of available) {
            lines.push(`[${providerName}]`);
            for (const id of modelIds) {
              const info = SUPPORTED_MODELS[id];
              const marker = id === ctx.modelId ? " *" : "";
              if (info) {
                lines.push(`  ${id} — ${info.name} (${info.contextWindow.toLocaleString()} ctx)${marker}`);
              } else {
                lines.push(`  ${id}${marker}`);
              }
            }
          }

          if (lines.length === 0) {
            addSystemMessage(ctx, "No providers configured. Run setup or set API keys.");
          } else {
            addSystemMessage(ctx, lines.join("\n"));
          }
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          addSystemMessage(ctx, `Failed to list models: ${msg}`);
        }
      } else if (arg) {
        // Validate the model exists before switching
        const info = SUPPORTED_MODELS[arg];
        if (info) {
          switchModel(arg);
          addSystemMessage(ctx, `Switched to model: ${arg} (${info.provider})`);
        } else {
          const available = Object.keys(SUPPORTED_MODELS).join(", ");
          addSystemMessage(ctx, `Unknown model: ${arg}\nAvailable: ${available}`);
        }
      } else {
        const info = SUPPORTED_MODELS[ctx.modelId];
        const detail = info
          ? `${ctx.modelId} (${info.provider}) — ${info.contextWindow.toLocaleString()} ctx`
          : ctx.modelId;
        addSystemMessage(ctx, `Current model: ${detail}`);
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
      await handleTeamCommand(arg, ctx);
      break;

    case "/quit":
    case "/exit":
      process.exit(0);
      break;

    default:
      addSystemMessage(ctx, `Unknown command: ${command}. Type /help for available commands.`);
  }
}

// ── Team Agent Definitions (8-role split-panel team per PRD section 8) ────

interface ITeamAgentDefinition {
  readonly name: string;
  readonly agentType: string;
  readonly model: string;
  readonly provider: ProviderName;
  readonly role: ModelRole;
}

const TEAM_AGENT_DEFINITIONS: readonly ITeamAgentDefinition[] = [
  {
    name: "ProjectManager",
    agentType: "lead",
    model: "claude-opus-4-6",
    provider: "anthropic",
    role: "planning",
  },
  {
    name: "ResearchAnalyst",
    agentType: "researcher",
    model: "gemini-2.5-pro",
    provider: "google",
    role: "planning",
  },
  {
    name: "TechnicalImplementationResearcher",
    agentType: "researcher",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    role: "coding",
  },
  {
    name: "CLIDesigner",
    agentType: "designer",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    role: "planning",
  },
  {
    name: "TypeScriptDeveloper",
    agentType: "developer",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    role: "coding",
  },
  {
    name: "CodeReviewer",
    agentType: "reviewer",
    model: "claude-opus-4-6",
    provider: "anthropic",
    role: "review",
  },
  {
    name: "EnterpriseArchitect",
    agentType: "architect",
    model: "claude-opus-4-6",
    provider: "anthropic",
    role: "planning",
  },
  {
    name: "SecurityAuditor",
    agentType: "auditor",
    model: "claude-opus-4-6",
    provider: "anthropic",
    role: "review",
  },
];

async function handleTeamCommand(subcommand: string | undefined, ctx: ICommandContext): Promise<void> {
  if (subcommand === "stop") {
    ctx.panel.deactivate();
    addSystemMessage(ctx, "Team deactivated. Returned to single-pane mode.");
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

  // Default: create the 8-role team and activate split-panel mode
  const teamName = subcommand ?? `team-${Date.now()}`;

  addSystemMessage(ctx, `Creating 8-role agent team "${teamName}" with split-panel mode...`);

  try {
    const { TeamManager } = await import("../teams/team-manager.js");
    const manager = new TeamManager();

    const teamConfig = await manager.createTeam(teamName, {
      description: "8-role enterprise agent team with split-panel coordination",
      agents: TEAM_AGENT_DEFINITIONS,
    });

    // Build IAgentState objects for the panel
    const agentStates: IAgentState[] = teamConfig.members.map((member) => ({
      config: member,
      status: "idle" as const,
    }));

    // Activate split-panel mode with all agents
    ctx.panel.setAgents(agentStates);
    ctx.panel.activate();

    // Start agent processes
    await manager.startAgents(teamName);

    // Output confirmation with each agent's role
    const agentLines = TEAM_AGENT_DEFINITIONS.map(
      (def) => `  ${def.name} (${def.model}) — ${def.role}`,
    );
    addSystemMessage(
      ctx,
      `Team "${teamName}" created — split-panel active.\n${agentLines.join("\n")}\nUse Tab to switch agents. /team stop to return to single-pane.`,
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    addSystemMessage(ctx, `Failed to create team: ${msg}`);
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

type FirstRunProvider = "claude" | "codex" | "gemini" | "kimi";

interface IFirstRunLogin {
  login(): Promise<unknown>;
}

async function createFirstRunLogin(provider: FirstRunProvider): Promise<IFirstRunLogin> {
  switch (provider) {
    case "claude": {
      const { ClaudeLogin } = await import("../auth/providers/claude-login.js");
      return new ClaudeLogin();
    }
    case "codex": {
      const { CodexLogin } = await import("../auth/providers/codex-login.js");
      return new CodexLogin();
    }
    case "gemini": {
      const { GeminiLogin } = await import("../auth/providers/gemini-login.js");
      return new GeminiLogin();
    }
    case "kimi": {
      const { KimiLogin } = await import("../auth/providers/kimi-login.js");
      return new KimiLogin();
    }
  }
}

export async function runFirstRunSetup(): Promise<void> {
  const { confirm } = await import("@inquirer/prompts");
  const pc = await import("picocolors");

  process.stdout.write(
    [
      "",
      pc.default.cyan("  ╔══════════════════════════════════════════════╗"),
      pc.default.cyan("  ║           Welcome to AemeathCLI              ║"),
      pc.default.cyan("  ║    Multi-Model CLI Coding Tool v1.0.0        ║"),
      pc.default.cyan("  ╚══════════════════════════════════════════════╝"),
      "",
      "  Let's get you set up:",
      "",
    ].join("\n"),
  );

  const providers: readonly FirstRunProvider[] = ["claude", "codex", "gemini", "kimi"];

  for (const provider of providers) {
    const shouldLogin = await confirm({
      message: `Log in to ${provider}?`,
      default: provider !== "kimi",
    });

    if (shouldLogin) {
      process.stdout.write(pc.default.cyan(`  Logging in to ${provider}...\n`));
      try {
        const login = await createFirstRunLogin(provider);
        await login.login();
        process.stdout.write(pc.default.green(`  ✓ ${provider} - Logged in successfully\n`));
      } catch {
        process.stdout.write(pc.default.red(`  ✗ ${provider} - Login failed (you can retry later)\n`));
      }
    }
  }

  process.stdout.write(pc.default.green("\n  ✓ Configuration saved. Ready!\n\n"));
}
