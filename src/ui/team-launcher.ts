/**
 * Prompt-based team creation — orchestrates LLM design and pane launches.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 *
 * Supports three launch modes:
 * 1. iTerm2 native panes (macOS, preferred when in iTerm2)
 * 2. tmux split panes (inside existing tmux session or new session)
 * 3. In-process split-panel mode (fallback when tmux unavailable)
 */

import type {
  IGlobalConfig,
  IAgentState,
  AgentStatus,
  ProviderName,
  IPaneConfig,
  ILayoutConfig,
  PaneLayout,
} from "../types/index.js";
import { SUPPORTED_MODELS } from "../types/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { SetMessagesDispatch } from "./commands/types.js";
import { v4Id } from "./utils.js";
import type { ILLMAgentSpec } from "./team-design.js";
import {
  TEAM_DESIGN_SYSTEM_PROMPT,
  buildTeamDesignUserPrompt,
  parseLLMTeamDesign,
  normalizeLeadAgentSpec,
  resolveMasterProviderPriority,
  getAvailableModelsForProviders,
  pickLeadModel,
  writeAgentLauncherScript,
} from "./team-design.js";
import { getCliProviderEntry } from "../orchestrator/utils/provider-catalog.js";
import type { TmuxManager } from "../panes/tmux-manager.js";
import type { execa as ExecaFn } from "execa";
import type NodeFs from "node:fs";
import type NodePath from "node:path";
import {
  setActiveTeamManager,
  setActiveTeamName,
  setActiveTmuxCleanup,
} from "./team-state.js";

interface ITeamPanelControls {
  readonly isSplitPanelActive: boolean;
  readonly setAgents: (agents: readonly IAgentState[]) => void;
  readonly activate: () => void;
  readonly appendOutput: (
    agentId: string,
    content: string,
    options?: { readonly immediate?: boolean },
  ) => void;
  readonly updateAgentStatus: (agentId: string, status: AgentStatus) => void;
}

function sysMsg(setMessages: SetMessagesDispatch, content: string): void {
  setMessages((prev) => [
    ...prev,
    { id: v4Id(), role: "system" as const, content, createdAt: new Date() },
  ]);
}

export async function handlePromptBasedTeamCreation(
  input: string,
  setMessages: SetMessagesDispatch,
  panel: ITeamPanelControls,
  getRegistry: () => Promise<ProviderRegistry>,
  currentModelId: string,
  config: IGlobalConfig,
  swarmConfig: IGlobalConfig["swarm"],
): Promise<string | undefined> {
  const teamName = `team-${Date.now()}`;

  setMessages((prev) => [
    ...prev,
    { id: v4Id(), role: "user" as const, content: input, createdAt: new Date() },
    { id: v4Id(), role: "system" as const, content: "Analyzing your request to design the agent team...", createdAt: new Date() },
  ]);

  try {
    // 1. Detect installed CLIs and resolve master-agent preference order.
    const registry = await getRegistry();
    const { detectInstalledProviders } = await import("../orchestrator/utils/detect-providers.js");
    const installedClis = detectInstalledProviders();
    const prioritizedMasterProviders = resolveMasterProviderPriority(swarmConfig, installedClis);
    const availableModels = getAvailableModelsForProviders(installedClis);

    if (availableModels.length === 0) {
      sysMsg(setMessages, "No AI CLI tools detected. Install at least one: claude, codex, gemini, kimi, or ollama.");
      return;
    }

    const masterLeadModel = pickLeadModel(config, prioritizedMasterProviders, availableModels);
    if (masterLeadModel === undefined) {
      return;
    }

    // 2. Use the user's current active model to design the team (already authenticated).
    //    Fall back to the resolved planning model only if the registry lacks the current model.
    const designModel = registry.hasModel(currentModelId)
      ? currentModelId
      : registry.hasModel(masterLeadModel) ? masterLeadModel : undefined;
    if (!designModel) {
      sysMsg(setMessages, "Swarm team design needs at least one authenticated chat provider. Run `aemeathcli auth login` or configure an API key, then try again.");
      return;
    }
    const designProvider = registry.getForModel(designModel);
    const primaryMasterLabel = prioritizedMasterProviders[0]
      ? getCliProviderEntry(prioritizedMasterProviders[0]).label
      : "current configuration";
    const userPrompt =
      `${buildTeamDesignUserPrompt(input, availableModels)}\n\n` +
      `Master-agent provider priority:\n` +
      `${prioritizedMasterProviders.map((provider) => `- ${getCliProviderEntry(provider).label}`).join("\n")}\n\n` +
      `The sponsoring lead agent must use ${primaryMasterLabel} when possible.`;

    const DESIGN_TIMEOUT_MS = 60_000;
    sysMsg(setMessages, `Designing team with ${designModel}...`);

    const designStream = designProvider.stream({
      model: designModel,
      messages: [{ id: v4Id(), role: "user" as const, content: userPrompt, createdAt: new Date() }],
      system: TEAM_DESIGN_SYSTEM_PROMPT,
      maxTokens: 4000,
    });

    let designResponse = "";
    const designResult = await Promise.race([
      (async () => {
        for await (const chunk of designStream) {
          if (chunk.type === "text" && chunk.content) designResponse += chunk.content;
          if (chunk.type === "error" && chunk.error) throw new Error(`Design stream error: ${chunk.error}`);
        }
        return designResponse;
      })(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => { reject(new Error(`Team design timed out after ${DESIGN_TIMEOUT_MS / 1000}s. Check your API credentials and try again.`)); }, DESIGN_TIMEOUT_MS);
      }),
    ]);
    designResponse = designResult;

    // 3. Parse the LLM's team design.
    //    Prefer the user's active model for the lead agent when it's in the available pool.
    const teamMasterModel = availableModels.includes(currentModelId)
      ? currentModelId
      : masterLeadModel;
    const agentSpecs = normalizeLeadAgentSpec(
      parseLLMTeamDesign(designResponse, availableModels, designModel),
      teamMasterModel ?? designModel,
    );

    const projectRoot = process.cwd();
    const isWindows = process.platform === "win32";
    const isWindowsTerminal = isWindows
      && typeof process.env["WT_SESSION"] === "string"
      && process.env["WT_SESSION"].length > 0;

    // 4. Windows without Windows Terminal — no native pane support available.
    //    Skip bash/PS1 script generation and go directly to in-process split-panel.
    if (isWindows && !isWindowsTerminal) {
      await launchInProcess(
        agentSpecs, input, teamName, config, panel, setMessages, projectRoot,
      );
      return undefined;
    }

    // 5. Prepare shared resources for terminal-pane launch modes.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const { execa: execaPane } = await import("execa");

    const boardDir = path.join(process.cwd(), ".aemeathcli", "team-board");
    fs.mkdirSync(boardDir, { recursive: true });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aemeathcli-team-"));
    const shellEscape = (s: string): string => s.replace(/'/gu, "'\\''");

    const [leadSpec, ...workerSpecs] = agentSpecs;
    if (!leadSpec) return;

    // Write team manifest
    const teamManifest = {
      teamName, task: input, boardDir, leadAgent: leadSpec.name,
      agents: agentSpecs.map((s) => ({
        name: s.name, agentType: s.agentType, model: s.model, role: s.role,
        outputFile: path.join(boardDir, `${s.name}.md`),
      })),
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(boardDir, "team-manifest.json"), JSON.stringify(teamManifest, null, 2), "utf-8");

    const teamRoster = agentSpecs
      .map((s) => `  - ${s.name} (${s.agentType}, ${s.model}) — role: ${s.role}`)
      .join("\n");

    // Build worker commands
    const workerCommands: Array<{ name: string; command: string }> = [];
    for (const spec of workerSpecs) {
      const outputFile = path.join(boardDir, `${spec.name}.md`);
      const promptFile = path.join(tempDir, `${spec.name}.txt`);
      const prompt = [
        `# Team Role: ${spec.name}`,
        `Type: ${spec.agentType} | Model: ${spec.model} | Role: ${spec.role}`,
        "", "## Your Task", spec.taskPrompt, "",
        "## Team Context",
        `You are part of a ${agentSpecs.length}-agent team working collaboratively.`,
        `Each agent has a specific domain. Do NOT overlap with other agents' responsibilities.`,
        "", "### Team Members:", teamRoster, "",
        "## Shared Workspace",
        `Team board directory: ${boardDir}`,
        `Your output file: ${outputFile}`,
        `Team manifest: ${path.join(boardDir, "team-manifest.json")}`,
        "", "## Coordination Protocol",
        `1. Write ALL your findings, analysis, and deliverables to your output file: ${outputFile}`,
        `2. You can read other agents' output files in ${boardDir}/ to check their progress and avoid duplication.`,
        `3. Focus on YOUR specific domain. Reference other agents' work when relevant to your analysis.`,
        `4. Read and analyze source files in the project directory to complete your task.`,
        `5. Be thorough and specific. Include file paths, line numbers, and code snippets in your findings.`,
        "", "## Coordination with Lead",
        `The team lead is ${leadSpec.name}. Check their coordination plan at: ${path.join(boardDir, "coordinator.md")}`,
        `After completing your work, the lead agent will read your output and synthesize findings.`,
        "", "## User's Original Request", input,
      ].join("\n");
      fs.writeFileSync(promptFile, prompt, "utf-8");

      const modelInfo = SUPPORTED_MODELS[spec.model];
      const provider = modelInfo?.provider ?? "anthropic";
      const launcherFile = path.join(tempDir, `${spec.name}-launch.sh`);
      const cmd = writeAgentLauncherScript(
        provider, spec.model, promptFile, launcherFile,
        projectRoot, shellEscape, fs.writeFileSync,
      );
      workerCommands.push({ name: spec.name, command: cmd });
    }

    // Build lead agent coordination task
    const leadOutputFile = path.join(boardDir, `${leadSpec.name}.md`);
    const leadCoordinationTask = [
      `I am the team coordinator (${leadSpec.name}, ${leadSpec.model}).`,
      "", leadSpec.taskPrompt, "",
      `## My Responsibilities`,
      `1. Break down the user's request into clear subtasks for each team member.`,
      `2. Write my coordination plan and task assignments to: ${path.join(boardDir, "coordinator.md")}`,
      `3. After completing my own analysis, read other agents' output files in ${boardDir}/ to check progress.`,
      `4. Synthesize findings from all agents into a final team summary at: ${path.join(boardDir, "SUMMARY.md")}`,
      `5. Flag any conflicts, gaps, or overlaps between agents' work.`,
      "", `## Team Members Working in Parallel Panes`,
      ...workerSpecs.map((s) => `- ${s.name} (${s.model}): writing to ${path.join(boardDir, s.name + ".md")}`),
      "", `## My Output File: ${leadOutputFile}`,
      "", `## User's Original Request`, input, "",
      `Start by reading the codebase and writing my coordination plan to ${path.join(boardDir, "coordinator.md")}.`,
    ].join("\n");

    const leadPromptFile = path.join(tempDir, `${leadSpec.name}.txt`);
    const leadLauncherFile = path.join(tempDir, `${leadSpec.name}-launch.sh`);
    fs.writeFileSync(leadPromptFile, leadCoordinationTask, "utf-8");
    const leadCommand = writeAgentLauncherScript(
      SUPPORTED_MODELS[leadSpec.model]?.provider ?? "anthropic",
      leadSpec.model, leadPromptFile, leadLauncherFile,
      projectRoot, shellEscape, fs.writeFileSync,
    );
    const allPaneCommands = [{ name: leadSpec.name, command: leadCommand }, ...workerCommands];

    const formatAgentLines = (lead: string) =>
      agentSpecs.map((spec) =>
        spec.name === lead
          ? `  ${spec.name} (${spec.model}) — ${spec.role} [LEAD — this pane]`
          : `  ${spec.name} (${spec.model}) — ${spec.role}`,
      );

    // 6. iTerm2 native pane support (macOS)
    const isITerm2 = process.platform === "darwin" && process.env["TERM_PROGRAM"] === "iTerm.app";

    if (isITerm2) {
      return await launchITerm2(
        agentSpecs, leadSpec, workerCommands, teamName, tempDir, boardDir,
        shellEscape, fs, path, execaPane, setMessages, formatAgentLines, leadCoordinationTask,
      );
    }

    // 7. Windows Terminal native pane support (Windows)
    if (isWindowsTerminal) {
      return await launchWindowsTerminal(
        agentSpecs, leadSpec, workerCommands, teamName, tempDir, boardDir,
        fs, execaPane, setMessages, formatAgentLines, leadCoordinationTask, projectRoot,
      );
    }

    // 8. tmux-based split-panel mode
    const { TmuxManager } = await import("../panes/tmux-manager.js");
    const tmux = new TmuxManager();
    const tmuxAvailable = await tmux.isAvailable();

    if (tmuxAvailable) {
      const insideTmux = typeof process.env["TMUX"] === "string" && process.env["TMUX"].length > 0;
      if (insideTmux) {
        return await launchTmuxInSession(
          agentSpecs, leadSpec, workerCommands, teamName, tempDir, boardDir,
          fs, execaPane, setMessages, formatAgentLines, leadCoordinationTask,
        );
      }
      return await launchTmuxNewSession(
        agentSpecs, teamName, tempDir, boardDir, allPaneCommands,
        tmux, fs, setMessages, formatAgentLines, leadSpec, leadCoordinationTask,
      );
    }

    // 9. In-process fallback (no native pane support detected)
    await launchInProcess(
      agentSpecs, input, teamName, config, panel, setMessages, projectRoot,
    );
    return undefined;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    sysMsg(setMessages, `Failed to create team: ${msg}`);
    return undefined;
  }
}

// ── iTerm2 Launch ────────────────────────────────────────────────────────

async function launchITerm2(
  agentSpecs: readonly ILLMAgentSpec[],
  leadSpec: ILLMAgentSpec,
  workerCommands: Array<{ name: string; command: string }>,
  teamName: string,
  tempDir: string,
  boardDir: string,
  shellEscape: (s: string) => string,
  fs: typeof NodeFs,
  path: typeof NodePath,
  execaPane: typeof ExecaFn,
  setMessages: SetMessagesDispatch,
  formatAgentLines: (lead: string) => string[],
  leadCoordinationTask: string,
): Promise<string | undefined> {
  sysMsg(setMessages, `Designed ${agentSpecs.length}-agent team. Creating iTerm2 split panes...`);

  const asEscape = (s: string): string => s.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
  const scriptLines: string[] = [];
  scriptLines.push('tell application "iTerm2"');
  scriptLines.push("  tell current window");
  scriptLines.push("    set leaderSession to current session of current tab");

  for (const [i, agent] of workerCommands.entries()) {
    const prevVar = i === 0 ? "leaderSession" : `agent${i - 1}`;
    const curVar = `agent${i}`;
    const splitDir = i === 0 ? "vertically" : "horizontally";
    scriptLines.push(`    tell ${prevVar}`);
    scriptLines.push(`      set ${curVar} to (split ${splitDir} with default profile)`);
    scriptLines.push("    end tell");
    scriptLines.push(`    tell ${curVar}`);
    scriptLines.push(`      set name to "${asEscape(agent.name)}"`);
    scriptLines.push(`      write text "${asEscape(agent.command)}"`);
    scriptLines.push("    end tell");
  }

  scriptLines.push("    select leaderSession");
  scriptLines.push("  end tell");
  scriptLines.push("end tell");

  const scriptFile = path.join(tempDir, "create-panes.applescript");
  fs.writeFileSync(scriptFile, scriptLines.join("\n"), "utf-8");

  try {
    await execaPane("osascript", [scriptFile]);
  } catch (scriptErr: unknown) {
    const errMsg = scriptErr instanceof Error ? scriptErr.message : String(scriptErr);
    sysMsg(setMessages, `Failed to create iTerm2 panes: ${errMsg.slice(0, 200)}`);
    return;
  }

  setActiveTeamName(teamName);
  setActiveTeamManager(undefined);
  setActiveTmuxCleanup(async () => {
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync("pkill", ["-f", tempDir], { stdio: "ignore" });
    } catch { /* no matching processes */ }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(boardDir, { recursive: true, force: true });
    } catch { /* non-critical */ }
  });

  const agentLines = formatAgentLines(leadSpec.name);
  sysMsg(setMessages,
    `Team "${teamName}" — ${agentSpecs.length} agents active.\n` +
    `${workerCommands.length} worker panes in iTerm2 + lead coordinating here.\n` +
    `${agentLines.join("\n")}\n/team stop to shut down all agents.`,
  );
  return leadCoordinationTask;
}

// ── Windows Terminal Launch ───────────────────────────────────────────────

async function launchWindowsTerminal(
  agentSpecs: readonly ILLMAgentSpec[],
  leadSpec: ILLMAgentSpec,
  workerCommands: Array<{ name: string; command: string }>,
  teamName: string,
  tempDir: string,
  boardDir: string,
  fs: typeof NodeFs,
  execaPane: typeof ExecaFn,
  setMessages: SetMessagesDispatch,
  formatAgentLines: (lead: string) => string[],
  leadCoordinationTask: string,
  projectRoot: string,
): Promise<string | undefined> {
  sysMsg(setMessages, `Designed ${agentSpecs.length}-agent team. Creating Windows Terminal split panes...`);

  // Build hub-and-spoke layout using wt.exe split-pane commands.
  // First worker: vertical split (creates left/right halves).
  // Subsequent workers: horizontal splits (stack on the right side).
  // After all splits, focus returns to the leader pane (first/leftmost).
  for (const [i, agent] of workerCommands.entries()) {
    const splitDir = i === 0 ? "-V" : "-H";
    const args = ["-w", "0", "sp", splitDir];
    if (i === 0) args.push("-s", "0.5");
    args.push("-d", projectRoot, "--title", agent.name);
    // The agent.command is a PowerShell launcher: powershell -ExecutionPolicy Bypass -File "path.ps1"
    // Pass it via cmd /c so wt.exe treats it as the pane's commandline.
    args.push("cmd", "/c", agent.command);

    try {
      await execaPane("wt", args);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      sysMsg(setMessages, `Failed to create WT pane for ${agent.name}: ${errMsg.slice(0, 200)}`);
    }
  }

  // Return focus to the leader pane (leftmost).
  try {
    await execaPane("wt", ["-w", "0", "mf", "first"]);
  } catch { /* non-fatal — focus may already be correct */ }

  setActiveTeamName(teamName);
  setActiveTeamManager(undefined);
  setActiveTmuxCleanup(async () => {
    // Clean up temp files. WT panes close when their process exits.
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(boardDir, { recursive: true, force: true });
    } catch { /* non-critical */ }
  });

  const agentLines = formatAgentLines(leadSpec.name);
  sysMsg(setMessages,
    `Team "${teamName}" — ${agentSpecs.length} agents active.\n` +
    `${workerCommands.length} worker panes in Windows Terminal + lead coordinating here.\n` +
    `${agentLines.join("\n")}\n` +
    `Keybindings:\n  Alt+Arrow     Switch pane\n  Alt+Shift+Arrow  Resize pane\n` +
    `/team stop to shut down all agents.`,
  );
  return leadCoordinationTask;
}

// ── tmux In-Session Launch ───────────────────────────────────────────────

async function launchTmuxInSession(
  agentSpecs: readonly ILLMAgentSpec[],
  leadSpec: ILLMAgentSpec,
  workerCommands: Array<{ name: string; command: string }>,
  teamName: string,
  tempDir: string,
  boardDir: string,
  fs: typeof NodeFs,
  execaPane: typeof ExecaFn,
  setMessages: SetMessagesDispatch,
  formatAgentLines: (lead: string) => string[],
  leadCoordinationTask: string,
): Promise<string | undefined> {
  sysMsg(setMessages, `Designed ${agentSpecs.length}-agent team. Creating tmux split panes...`);

  const currentResult = await execaPane("tmux", ["display-message", "-p", "#{pane_id}"]);
  const leaderPaneId = currentResult.stdout.trim();
  const agentPaneIds: string[] = [];

  for (const [i, agent] of workerCommands.entries()) {
    const splitResult = await execaPane("tmux", [
      "split-window", i === 0 ? "-h" : "-v", "-P", "-F", "#{pane_id}",
    ]);
    const newPaneId = splitResult.stdout.trim();
    agentPaneIds.push(newPaneId);
    await execaPane("tmux", ["send-keys", "-t", newPaneId, agent.command, "Enter"]);
  }
  if (workerCommands.length > 0) {
    try { await execaPane("tmux", ["select-layout", "main-vertical"]); } catch { /* non-fatal */ }
  }
  try { await execaPane("tmux", ["select-pane", "-t", leaderPaneId]); } catch { /* non-fatal */ }

  setActiveTeamName(teamName);
  setActiveTeamManager(undefined);
  setActiveTmuxCleanup(async () => {
    const { execa: ex } = await import("execa");
    for (const pid of agentPaneIds) {
      try { await ex("tmux", ["kill-pane", "-t", pid]); } catch { /* pane may be gone */ }
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(boardDir, { recursive: true, force: true });
    } catch { /* non-critical */ }
  });

  const agentLines = formatAgentLines(leadSpec.name);
  sysMsg(setMessages,
    `Team "${teamName}" — ${agentSpecs.length} agents active.\n` +
    `${workerCommands.length} worker panes in tmux + lead coordinating here.\n` +
    `${agentLines.join("\n")}\n/team stop to shut down all agents.`,
  );
  return leadCoordinationTask;
}

// ── tmux New-Session Launch ──────────────────────────────────────────────

async function launchTmuxNewSession(
  agentSpecs: readonly ILLMAgentSpec[],
  teamName: string,
  tempDir: string,
  boardDir: string,
  allPaneCommands: Array<{ name: string; command: string }>,
  tmux: TmuxManager,
  fs: typeof NodeFs,
  setMessages: SetMessagesDispatch,
  formatAgentLines: (lead: string) => string[],
  leadSpec: ILLMAgentSpec,
  leadCoordinationTask: string,
): Promise<string | undefined> {
  sysMsg(setMessages, `Designed ${agentSpecs.length}-agent team. Opening tmux split-panel view...`);

  const sessionName = await tmux.createSession(teamName);
  const paneConfigs: IPaneConfig[] = agentSpecs.map((spec, i) => ({
    paneId: `pane-${i}`, agentName: spec.name, model: spec.model, role: spec.role,
    title: `${spec.name} (${spec.model})`,
  }));
  const layoutConfig: ILayoutConfig = {
    layout: "hub-spoke" as PaneLayout, panes: paneConfigs, maxPanes: paneConfigs.length,
  };
  await tmux.createPanes(layoutConfig);

  for (const [i, agent] of allPaneCommands.entries()) {
    await tmux.sendCommand(`pane-${i}`, agent.command);
  }

  setActiveTeamName(teamName);
  setActiveTeamManager(undefined);
  setActiveTmuxCleanup(async () => {
    await tmux.destroy();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(boardDir, { recursive: true, force: true });
    } catch { /* non-critical */ }
  });

  sysMsg(setMessages,
    `Attaching to tmux session "${sessionName}" with ${agentSpecs.length} agents\u2026\n\n` +
    `Inside tmux:\n  Ctrl+B \u2192/\u2190/\u2191/\u2193   Switch pane\n  Ctrl+B  d            Detach (return to aemeath)\n  Ctrl+B  z            Zoom pane fullscreen`,
  );

  // Auto-attach: temporarily release terminal from Ink, hand it to tmux.
  const { execFileSync } = await import("node:child_process");
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();

  try {
    execFileSync("tmux", ["attach-session", "-t", sessionName], { stdio: "inherit" });
  } catch { /* User detached from tmux or attach failed */ }

  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  const agentLines = formatAgentLines(leadSpec.name);
  sysMsg(setMessages,
    `Detached from tmux. Agents may still be running.\n\nAgents:\n${agentLines.join("\n")}\n\n` +
    `Keybindings (inside tmux):\n` +
    `  Ctrl+B \u2192 \u2190 \u2191 \u2193   Switch between panes\n` +
    `  Ctrl+B  d            Detach (return here)\n  Ctrl+B  z            Zoom active pane (fullscreen toggle)\n` +
    `  Ctrl+B  x            Close active pane\n\n` +
    `Re-attach:  tmux attach -t ${sessionName}\n/team stop  Shut down all agents and kill session`,
  );
  return leadCoordinationTask;
}

// ── In-Process Fallback Launch ───────────────────────────────────────────

async function launchInProcess(
  agentSpecs: readonly ILLMAgentSpec[],
  input: string,
  teamName: string,
  config: IGlobalConfig,
  panel: ITeamPanelControls,
  setMessages: SetMessagesDispatch,
  projectRoot: string,
): Promise<undefined> {
  sysMsg(setMessages,
    `Designed ${agentSpecs.length}-agent team. Starting agents (in-process mode)\u2026\n\n` +
    `Keybindings:\n  Tab              Switch to next agent\n` +
    `  Ctrl+1-${agentSpecs.length}          Jump to agent N\n  /team stop       Exit team mode`,
  );

  const agentDefinitions = agentSpecs.map((spec) => {
    const modelInfo = SUPPORTED_MODELS[spec.model];
    const provider: ProviderName = modelInfo?.provider ?? "anthropic";
    return { name: spec.name, agentType: spec.agentType, model: spec.model, provider, role: spec.role };
  });

  const { TeamManager: TM } = await import("../teams/team-manager.js");
  const manager = new TM();
  setActiveTeamManager(manager);
  setActiveTeamName(teamName);
  setActiveTmuxCleanup(undefined);

  const agentAllowedPaths = Array.from(new Set([projectRoot, ...config.permissions.allowedPaths]));
  const teamConfig = manager.createTeam(teamName, {
    description: `Agent team for: ${input.slice(0, 120)}`,
    agents: agentDefinitions,
    agentEnv: {
      AEMEATHCLI_TOOL_PROJECT_ROOT: projectRoot,
      AEMEATHCLI_TOOL_WORKING_DIRECTORY: projectRoot,
      AEMEATHCLI_TOOL_PERMISSION_MODE: config.permissions.mode,
      AEMEATHCLI_TOOL_ALLOWED_PATHS: JSON.stringify(agentAllowedPaths),
      AEMEATHCLI_TOOL_BLOCKED_COMMANDS: JSON.stringify(config.permissions.blockedCommands),
    },
  });

  const agentStates: IAgentState[] = teamConfig.members.map((member) => ({
    config: member, status: "idle" as const,
  }));
  panel.setAgents(agentStates);
  panel.activate();

  for (const member of teamConfig.members) {
    panel.appendOutput(member.agentId, `[${member.name}] Starting (${member.model})...\n`, { immediate: true });
  }

  manager.onAgentMessages(teamName, (_agentName, method, params) => {
    if (method === "agent.streamChunk") {
      const agentId = typeof params["agentId"] === "string" ? params["agentId"] : "";
      const content = typeof params["content"] === "string" ? params["content"] : "";
      if (agentId && content) panel.appendOutput(agentId, content);
    }
    if (method === "agent.taskUpdate") {
      const agentId = typeof params["agentId"] === "string" ? params["agentId"] : "";
      const rawStatus = typeof params["status"] === "string" ? params["status"] : "";
      if (agentId && rawStatus) {
        const statusMap: Record<string, AgentStatus> = { in_progress: "active", completed: "idle" };
        const mapped = statusMap[rawStatus];
        if (mapped) panel.updateAgentStatus(agentId, mapped);
      }
    }
  });

  try { await manager.startAgents(teamName); } catch (startErr: unknown) {
    const errMsg = startErr instanceof Error ? startErr.message : String(startErr);
    sysMsg(setMessages, `Warning: Some agents failed to start: ${errMsg.slice(0, 200)}`);
  }

  const agentStatesAfterStart = manager.getAgentStates(teamName);
  const aliveCount = agentStatesAfterStart.filter((s) => s.status !== "error" && s.status !== "shutdown").length;
  if (aliveCount === 0) {
    sysMsg(setMessages, "All agents failed to start. Check your API credentials and try again.");
    return undefined;
  }

  for (const [i, member] of teamConfig.members.entries()) {
    const spec = agentSpecs[i];
    const taskId = v4Id();
    const prompt = spec
      ? `You are ${spec.name} (${spec.agentType}).\n\n${spec.taskPrompt}\n\nUser request:\n${input}`
      : `Work on the following task:\n\n${input}`;
    manager.assignTask(teamName, member.name, taskId, `${member.role}: ${input.slice(0, 80)}`, prompt);
  }

  const agentLines = agentSpecs.map((spec) => `  ${spec.name} (${spec.model}) — ${spec.role}`);
  sysMsg(setMessages,
    `Team "${teamName}" created with ${teamConfig.members.length} agents — split-panel active.\n` +
    `${agentLines.join("\n")}\nUse Tab to switch agents. /team stop to return to single-pane.`,
  );
  return undefined;
}
