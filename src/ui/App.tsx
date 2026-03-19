/**
 * Root TUI application component per PRD section 6.2
 * Orchestrates the entire interactive chat experience.
 *
 * Command handlers, team creation, and persistence logic are extracted to
 * separate modules to meet the PRD's module size guidelines.
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
  ProviderName,
  IModelDisplayEntry,
} from "../types/index.js";
import {
  DEFAULT_CONFIG,
  SUPPORTED_MODELS,
  PROVIDER_MODEL_ORDER,
  getThinkingConfigForModel,
} from "../types/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { InputMode } from "./components/InputBar.js";
import { v4Id } from "./utils.js";
import {
  registerDynamicFileRefs,
  registerDynamicSkills,
} from "./autocomplete-data.js";
import { ModelSelector } from "./components/ModelSelector.js";
import { ThinkingSelector } from "./components/ThinkingSelector.js";
import { LoginSelector } from "./components/LoginSelector.js";
import { SwarmOnboarding } from "./components/SwarmOnboarding.js";
import { getCliProviderEntry } from "../orchestrator/utils/provider-catalog.js";
import type { CliProviderType } from "../orchestrator/constants.js";

// Extracted modules
import type { SelectionMode } from "./commands/types.js";
import { handleInternalCommand } from "./commands/slash-router.js";
import { formatThinkingMethod } from "./commands/model-helpers.js";
import { handleSkillInvocation } from "./commands/skill-commands.js";
import { loadLoginModuleForSlash } from "./commands/login-commands.js";
import { persistMessages } from "./conversation-persistence.js";
import { handlePromptBasedTeamCreation } from "./team-launcher.js";
import { getActiveTeamManager, getActiveTeamName } from "./team-state.js";
import {
  DEFAULT_SYSTEM_PROMPT,
  getCandidateModels,
  normalizeSwarmConfig,
  swarmConfigsEqual,
} from "./app-helpers.js";

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

function App({ config, options }: IAppProps): React.ReactElement {
  const { resolution, modelId, switchModel, switchRole } = useModel(
    config,
    options.model,
    options.role as ModelRole | undefined,
  );
  const { state: streamState, startStream, cancelStream, reset: resetStream } = useStream();
  const { totalCost, totalTokens, record } = useCost(config.cost);

  const totalCostRef = useRef(totalCost);
  totalCostRef.current = totalCost;
  const totalTokensRef = useRef(totalTokens);
  totalTokensRef.current = totalTokens;
  const panel = usePanel();

  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesRef = useRef<IChatMessage[]>([]);
  messagesRef.current = messages;
  const [gitBranch, setGitBranch] = useState<string | undefined>();
  const [thinkingValue, setThinkingValue] = useState<string>("medium");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>({ type: "none" });
  const [modelDisplayOrder, setModelDisplayOrder] = useState<
    Readonly<Record<string, readonly IModelDisplayEntry[]>> | undefined
  >(undefined);
  const [persistentHistory, setPersistentHistory] = useState<string[]>([]);
  const [inputMode, setInputMode] = useState<InputMode>("agent-swarm");
  const [swarmConfig, setSwarmConfig] = useState<IGlobalConfig["swarm"]>(config.swarm);
  const [swarmOnboardingDeferred, setSwarmOnboardingDeferred] = useState(false);

  const registryRef = useRef<ProviderRegistry | undefined>(undefined);
  const getRegistry = useCallback(async (): Promise<ProviderRegistry> => {
    if (registryRef.current !== undefined) return registryRef.current;
    const { createDefaultRegistry } = await import("../providers/registry.js");
    registryRef.current = await createDefaultRegistry();
    return registryRef.current;
  }, []);

  const projectRootRef = useRef<string>(process.cwd());

  // ── Mount-time effects ─────────────────────────────────────────────────

  useEffect(() => {
    void import("../utils/pathResolver.js")
      .then(({ findProjectRoot }) => { projectRootRef.current = findProjectRoot(); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { findProjectRoot } = await import("../utils/pathResolver.js");
        const root = findProjectRoot();
        projectRootRef.current = root;
        const { loadInputHistory } = await import("../storage/input-history.js");
        const history = await loadInputHistory(root);
        if (history.length > 0) setPersistentHistory(history);
      } catch { /* Non-critical */ }
    })();
  }, []);

  useEffect(() => {
    void import("node:child_process")
      .then(({ execFile }) => {
        execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 2000 }, (error, stdout) => {
          if (!error && stdout) setGitBranch(stdout.trim());
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (options.isAgentPane) return;
    void import("../orchestrator/utils/detect-providers.js")
      .then(({ detectInstalledProviders }) => {
        const detected = detectInstalledProviders();
        if (detected.length > 0) setSwarmOnboardingDeferred(false);
        setSwarmConfig((prev) => {
          const next = normalizeSwarmConfig(prev, detected);
          return swarmConfigsEqual(prev, next) ? prev : next;
        });
      })
      .catch(() => {});
  }, [options.isAgentPane]);

  useEffect(() => {
    void (async () => {
      try {
        const { findProjectRoot } = await import("../utils/pathResolver.js");
        const projectRoot = findProjectRoot();
        projectRootRef.current = projectRoot;
        const { default: fg } = await import("fast-glob");
        const pathModule = await import("node:path");
        const fileRefs = await fg(["**/*"], {
          cwd: projectRoot, onlyFiles: true, dot: false, followSymbolicLinks: false,
          unique: true, suppressErrors: true,
          ignore: [".git/**", "node_modules/**", "dist/**", "coverage/**", ".aemeathcli/**", ".agents/**", "reference-gemini-cli/**", "cli-agent-orchestrator/**"],
        });
        const autocompleteItems = fileRefs
          .sort((left, right) => left.length !== right.length ? left.length - right.length : left.localeCompare(right))
          .slice(0, 400)
          .map((filePath) => ({
            label: `@${filePath}`,
            description: pathModule.dirname(filePath) === "." ? "project root file" : pathModule.dirname(filePath),
          }));
        registerDynamicFileRefs(autocompleteItems);
      } catch { registerDynamicFileRefs([]); }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { SkillRegistry } = await import("../skills/registry.js");
        const { findProjectRoot } = await import("../utils/pathResolver.js");
        const registry = new SkillRegistry();
        await registry.initialize(findProjectRoot());
        const all = registry.listAll();
        if (all.length > 0) {
          registerDynamicSkills(all.map((s) => ({ label: `$${s.name}`, description: s.description })));
        }
      } catch { /* Skill discovery failed */ }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { discoverModels, getDisplayOrder } = await import("../providers/model-discovery.js");
        await discoverModels();
        setModelDisplayOrder(getDisplayOrder());
      } catch { /* Model discovery failed */ }
    })();
  }, []);

  // ── Core submit handler ────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (input: string) => {
      if (input.startsWith("/")) {
        await handleInternalCommand(input, switchModel, switchRole, {
          totalCost: totalCostRef.current, totalTokens: totalTokensRef.current,
          setMessages, modelId, thinkingValue, setThinkingValue, setSelectionMode,
          resolution, panel: { setAgents: panel.setAgents, activate: panel.activate, deactivate: panel.deactivate, appendOutput: panel.appendOutput },
          getRegistry, projectRoot: projectRootRef.current,
        });
        return;
      }

      if (input.startsWith("$")) {
        await handleSkillInvocation(input, setMessages);
        return;
      }

      const activeTeamName = getActiveTeamName();
      const activeTeamManager = getActiveTeamManager();

      if (inputMode === "agent-swarm" && !options.isAgentPane && !panel.isSplitPanelActive && !activeTeamName) {
        setIsProcessing(true);
        try {
          const leaderTask = await handlePromptBasedTeamCreation(
            input, setMessages, panel, getRegistry, modelId, config, swarmConfig,
          );
          if (leaderTask) setTimeout(() => void handleSubmit(leaderTask), 1500);
        } finally {
          setIsProcessing(false);
        }
        return;
      }

      if (panel.isSplitPanelActive && activeTeamManager && activeTeamName) {
        const targetAgent = panel.agents[panel.activeAgentIndex] ?? panel.agents[0];
        if (!targetAgent) {
          setMessages((prev) => [...prev, { id: v4Id(), role: "system", content: "No active swarm agent is available to receive input.", createdAt: new Date() }]);
          return;
        }
        const taskId = v4Id();
        activeTeamManager.assignTask(activeTeamName, targetAgent.config.name, taskId, `User steering: ${input.slice(0, 72)}`, input);
        panel.appendOutput(targetAgent.config.agentId, `\n[User] ${input}\n`);
        panel.updateAgentStatus(targetAgent.config.agentId, "active");
        return;
      }

      const userMessage: IChatMessage = { id: v4Id(), role: "user", content: input, createdAt: new Date() };
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
          const providerOrUndefined = registry.hasModel(candidateModel) ? registry.getForModel(candidateModel) : undefined;
          if (!providerOrUndefined) { lastError = new Error(`No provider available for model "${candidateModel}"`); continue; }
          const candidateProvider = providerOrUndefined;

          let candidateContent = "";
          let caughtError: unknown;

          const stream = candidateProvider.stream({
            model: candidateModel, messages: allMessages,
            system: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT, maxTokens: 16_000,
          });

          async function* instrumentedStream(source: AsyncIterable<IStreamChunk>): AsyncGenerator<IStreamChunk> {
            try {
              for await (const chunk of source) {
                if (chunk.type === "text" && chunk.content) candidateContent += chunk.content;
                if (chunk.type === "usage" && chunk.usage) {
                  record(candidateProvider.name as ProviderName, candidateModel, chunk.usage.inputTokens, chunk.usage.outputTokens, resolution.role);
                }
                if (chunk.type === "error") caughtError = new Error(chunk.error ?? `Model "${candidateModel}" stream failed`);
                yield chunk;
              }
            } catch (err: unknown) { caughtError = err; throw err; }
          }

          resetStream();
          await startStream(instrumentedStream(stream));
          if (caughtError !== undefined) { lastError = caughtError; continue; }

          responseModel = candidateModel;
          responseProvider = candidateProvider.name as ProviderName;
          fullContent = candidateContent;
          completed = true;
          break;
        }

        if (!completed) {
          throw lastError instanceof Error ? lastError : new Error(typeof lastError === "string" ? lastError : "No model could produce a response");
        }

        if (fullContent.length > 0) {
          const assistantMessage: IChatMessage = {
            id: v4Id(), role: "assistant", content: fullContent,
            model: responseModel, provider: responseProvider, createdAt: new Date(),
          };
          setMessages((prev) => {
            const output: IChatMessage[] = [...prev];
            if (responseModel !== modelId) {
              output.push({ id: v4Id(), role: "system", content: `Primary model "${modelId}" failed. Switched to fallback "${responseModel}".`, createdAt: new Date() });
            }
            output.push(assistantMessage);
            return output;
          });
          void persistMessages(projectRootRef.current, userMessage, assistantMessage, responseModel, responseProvider);
        }
      } catch (error: unknown) {
        const errorContent = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [...prev, { id: v4Id(), role: "assistant", content: `Error: ${errorContent}`, model: modelId, createdAt: new Date() }]);
      } finally {
        setIsProcessing(false);
      }
    },
    [config, modelId, resolution, options.systemPrompt, record, switchModel, switchRole, startStream, resetStream, getRegistry, panel, thinkingValue, inputMode, options.isAgentPane, swarmConfig],
  );

  useEffect(() => {
    if (options.initialMessage) void handleSubmit(options.initialMessage);
  }, [handleSubmit, options.initialMessage]);

  const handleSubmitSync = useCallback((input: string): void => { void handleSubmit(input); }, [handleSubmit]);
  const handleCancel = useCallback(() => { cancelStream(); setIsProcessing(false); }, [cancelStream]);

  // ── Selection callbacks ────────────────────────────────────────────────

  const handleModelSelected = useCallback((selectedModelId: string) => {
    const thinkingCfg = getThinkingConfigForModel(selectedModelId);
    if (thinkingCfg) {
      setSelectionMode({ type: "thinking", modelId: selectedModelId });
    } else {
      switchModel(selectedModelId);
      setSelectionMode({ type: "none" });
      const info = SUPPORTED_MODELS[selectedModelId];
      setMessages((prev) => [...prev, { id: v4Id(), role: "system" as const, content: `Switched to model: ${info?.name ?? selectedModelId}`, createdAt: new Date() }]);
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
    setMessages((prev) => [...prev, { id: v4Id(), role: "system" as const, content: `Switched to model: ${info?.name ?? selectedModelId}\n${methodLabel}: ${optionLabel}`, createdAt: new Date() }]);
  }, [selectionMode, switchModel]);

  const handleSelectionCancel = useCallback(() => { setSelectionMode({ type: "none" }); }, []);

  const handleLoginSelected = useCallback(async (provider: string) => {
    setSelectionMode({ type: "none" });
    const loginMsg = provider === "gemini" ? "Logging in to gemini... A new terminal window will open for authentication." : `Logging in to ${provider}...`;
    setMessages((prev) => [...prev, { id: v4Id(), role: "system" as const, content: loginMsg, createdAt: new Date() }]);
    try {
      const loginModule = await loadLoginModuleForSlash(provider as "claude" | "codex" | "gemini" | "kimi");
      await loginModule.login();
      setMessages((prev) => [...prev, { id: v4Id(), role: "system" as const, content: `Successfully logged in to ${provider}`, createdAt: new Date() }]);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [...prev, { id: v4Id(), role: "system" as const, content: `Login failed: ${msg}`, createdAt: new Date() }]);
    }
  }, []);

  const handleSwarmOnboardingSelected = useCallback(async (primaryProvider: CliProviderType) => {
    const nextSwarmConfig: IGlobalConfig["swarm"] = {
      onboardingComplete: true, detectedProviders: swarmConfig.detectedProviders,
      primaryMasterProvider: primaryProvider,
      fallbackMasterProviders: swarmConfig.detectedProviders.filter((p) => p !== primaryProvider),
    };
    try {
      const { ConfigStore } = await import("../storage/config-store.js");
      const store = new ConfigStore();
      const currentConfig = store.loadGlobal();
      const nextProviders = { ...currentConfig.providers };
      for (const provider of nextSwarmConfig.detectedProviders) {
        const entry = getCliProviderEntry(provider);
        nextProviders[entry.provider] = { ...nextProviders[entry.provider], enabled: true };
      }
      store.saveGlobal({ ...currentConfig, providers: nextProviders, swarm: nextSwarmConfig });
      setSwarmOnboardingDeferred(false);
      setSwarmConfig(nextSwarmConfig);
      setSelectionMode({ type: "none" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [...prev, { id: v4Id(), role: "system" as const, content: `Failed to save swarm setup: ${message}`, createdAt: new Date() }]);
    }
  }, [swarmConfig.detectedProviders]);

  const handleSwarmOnboardingSkip = useCallback(() => {
    setSwarmOnboardingDeferred(true);
    setSelectionMode({ type: "none" });
  }, []);

  useEffect(() => {
    if (options.isAgentPane || panel.isSplitPanelActive || messages.length > 0 || isProcessing) return;
    if (selectionMode.type !== "none" || swarmOnboardingDeferred) return;
    if (swarmConfig.primaryMasterProvider === undefined) setSelectionMode({ type: "swarm-onboarding" });
  }, [isProcessing, messages.length, options.isAgentPane, panel.isSplitPanelActive, selectionMode.type, swarmConfig.primaryMasterProvider, swarmOnboardingDeferred]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (selectionMode.type === "swarm-onboarding") {
    return (
      <SwarmOnboarding
        detectedProviders={swarmConfig.detectedProviders}
        currentPrimaryProvider={swarmConfig.primaryMasterProvider}
        onSelect={(provider) => void handleSwarmOnboardingSelected(provider)}
        onSkip={handleSwarmOnboardingSkip}
      />
    );
  }

  if (selectionMode.type === "login") {
    return <LoginSelector onSelect={(provider) => void handleLoginSelected(provider)} onCancel={handleSelectionCancel} />;
  }

  if (selectionMode.type === "model") {
    return <ModelSelector currentModelId={modelId} onSelect={handleModelSelected} onCancel={handleSelectionCancel} modelOrder={modelDisplayOrder ?? PROVIDER_MODEL_ORDER} />;
  }

  if (selectionMode.type === "thinking") {
    const selectedInfo = SUPPORTED_MODELS[selectionMode.modelId];
    return <ThinkingSelector modelId={selectionMode.modelId} modelName={selectedInfo?.name ?? selectionMode.modelId} currentValue={thinkingValue} onSelect={handleThinkingSelected} onBack={handleSelectionCancel} />;
  }

  if (panel.isSplitPanelActive) {
    return (
      <SplitPane
        agents={panel.agents} activeAgentIndex={panel.activeAgentIndex}
        onSelectAgent={panel.selectAgent} agentOutputs={panel.agentOutputs}
        isProcessing={isProcessing} onSubmit={handleSubmitSync} onCancel={handleCancel}
        model={modelId} role={resolution.role} tokenCount={totalTokens} cost={totalCost} gitBranch={gitBranch}
      />
    );
  }

  return (
    <SinglePane
      messages={messages} isProcessing={isProcessing}
      onSubmit={handleSubmitSync} onCancel={handleCancel}
      model={modelId} role={resolution.role} tokenCount={totalTokens} cost={totalCost} gitBranch={gitBranch}
      streamingContent={streamState.content} activity={streamState.activity}
      initialHistory={persistentHistory} mode={inputMode} onModeChange={setInputMode}
    />
  );
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
