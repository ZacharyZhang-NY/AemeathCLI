# AemeathCLI Agent Orchestrator — Full Implementation Plan

> **Version:** 4.0.0
> **Date:** 2026-03-18
> **Status:** Implementation Ready
> **Scope:** Transform AemeathCLI into a true cross-platform Agent Swarm Orchestrator
> **Architecture:** In-Process Orchestrator + node-pty (macOS / Linux / Windows)
> **Reference:** AWS CAO, VS Code terminal architecture, Anthropic/OpenAI agent patterns

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Decision Record](#2-architecture-decision-record)
3. [Current State Analysis](#3-current-state-analysis)
4. [Target Architecture](#4-target-architecture)
5. [Phase 0 — Foundation Fixes](#5-phase-0--foundation-fixes)
6. [Phase 1 — PtySessionManager & State Layer](#6-phase-1--ptysessionmanager--state-layer)
7. [Phase 2 — Provider CLI Adapters](#7-phase-2--provider-cli-adapters)
8. [Phase 3 — In-Process Orchestrator Engine](#8-phase-3--in-process-orchestrator-engine)
9. [Phase 4 — Agent Profiles & Store](#9-phase-4--agent-profiles--store)
10. [Phase 5 — CLI Commands & UX](#10-phase-5--cli-commands--ux)
11. [Phase 6 — Observability & Guardrails](#11-phase-6--observability--guardrails)
12. [Phase 7 — Testing & Hardening](#12-phase-7--testing--hardening)
13. [File-by-File Implementation Map](#13-file-by-file-implementation-map)
14. [Data Models & Schema](#14-data-models--schema)
15. [Orchestration Tool Specifications](#15-orchestration-tool-specifications)
16. [Platform-Specific Behavior](#16-platform-specific-behavior)
17. [Migration Strategy](#17-migration-strategy)
18. [Dependency Changes](#18-dependency-changes)
19. [Risk Analysis & Mitigations](#19-risk-analysis--mitigations)
20. [Success Criteria](#20-success-criteria)

---

## 1. Executive Summary

### The Problem

AemeathCLI has working provider connectors (Claude, OpenAI, Gemini, Kimi, Ollama) but incomplete orchestration. The current `TeamManager` uses Node.js `fork()` limiting cross-provider work. tmux-based approaches exclude Windows entirely.

### The Solution

An **in-process, cross-platform orchestrator** using:

1. **`node-pty`** (Microsoft, 1.3M weekly downloads, powers VS Code) as the terminal session layer — works natively on **macOS, Linux, and Windows** via Unix PTY / ConPTY
2. **A plain tool-calling while loop** using the existing `IModelProvider.chat()` interface — verified against the actual `IChatRequest`/`IChatResponse`/`IToolDefinition` types
3. **Orchestration tools** registered as `IToolRegistration` objects in the existing `ToolRegistry` — not a parallel system
4. **Optional tmux visual overlay** on macOS/Linux for debugging

### Why No Framework for the Supervisor Loop

AemeathCLI already has everything needed:

| What's Needed | Already Exists | Exact Interface |
|--------------|----------------|-----------------|
| LLM call with tools | `IModelProvider.chat()` | Takes `IChatRequest` (incl. `tools: IToolDefinition[]`), returns `IChatResponse` |
| Tool calls in response | `IChatResponse.message.toolCalls` | `IToolCall[]` with `id`, `name`, `arguments` |
| Finish reason | `IChatResponse.finishReason` | `"tool_calls"` when tools invoked, `"stop"` when done |
| Tool execution | `ToolRegistry.execute()` | Takes `IToolCall` + `IToolExecutionContext`, returns `IToolResult` |
| Tool definitions | `ToolRegistry.getDefinitions()` | Returns `IToolDefinition[]` |
| Model selection | `ModelRouter.resolve(role?)` | Returns `IModelResolution` with `modelId`, `provider` |
| Provider lookup | `ProviderRegistry.getForModel(modelId)` | Returns `IModelProvider` |
| Cost tracking | `CostTracker.record()` | Takes `provider, model, inputTokens, outputTokens, role` |
| Streaming | `IModelProvider.stream()` | Returns `AsyncIterable<IStreamChunk>` |

The supervisor loop is ~50 lines using these exact interfaces:
```typescript
while (step < maxSteps) {
  const response = await provider.chat({ model, messages, tools, system });
  messages.push(response.message);
  if (response.finishReason !== "tool_calls") break;
  for (const call of response.message.toolCalls ?? []) {
    const result = await toolRegistry.execute(call, toolContext);
    messages.push({ role: "tool", content: result.content, toolCallId: call.id, ... });
  }
  step++;
}
```

### Why node-pty Over tmux

| Aspect | tmux | node-pty |
|--------|------|----------|
| **Windows** | No | Yes (ConPTY) |
| **macOS / Linux** | Yes | Yes (Unix PTY) |
| **Maintained by** | tmux team | **Microsoft** |
| **Used by** | CAO, agent farms | **VS Code** (hundreds of millions of users) |
| **Output access** | Snapshot (`capture-pane`) | **Real-time stream** (`onData`) |
| **Input** | Shell out (`send-keys`) | **Direct** (`pty.write()`) |

---

## 2. Architecture Decision Record

### ADR-001: node-pty as Terminal Layer

**Decision:** Use `node-pty` (Microsoft) as the primary terminal session manager.

**Consequences:**
- (+) Cross-platform: macOS, Linux, Windows
- (+) Real-time output streaming via `onData`
- (+) Direct input via `pty.write()`
- (-) Native module requires compilation (prebuilts mitigate)
- (-) Must manage output buffer manually
- (-) Known Windows ConPTY quirks (documented in Section 16)

### ADR-002: Custom Tool Loop Using Existing Interfaces

**Context:** The codebase has fully-typed `IChatRequest`/`IChatResponse`/`IToolDefinition`/`IToolCall`/`IToolResult` interfaces, a `ToolRegistry` with `execute()` and `getDefinitions()`, `ModelRouter.resolve()`, and `ProviderRegistry.getForModel()`.

**Decision:** Build the tool loop using these exact interfaces. Register orchestration tools as `IToolRegistration` objects in the existing `ToolRegistry`. No parallel tool system.

**Consequences:**
- (+) Zero type mismatches — uses existing interfaces verbatim
- (+) Orchestration tools are first-class citizens alongside read/write/bash
- (+) Permission system, logging, and error handling from `ToolRegistry` apply automatically
- (+) `getDefinitions()` returns orchestration tools alongside built-in tools

### ADR-003: Supervisor Model vs Worker Provider

**Context:** The user passes `--provider claude-code` on the CLI. But the supervisor uses the SDK (not the CLI tool), and workers use CLI tools.

**Decision:**
- `--provider` sets the **default worker CLI provider** (e.g., `claude-code`, `codex`)
- The **supervisor model** is resolved via `ModelRouter.resolve("planning")` using the existing role config
- A separate `--supervisor-model` flag allows explicit override via `ModelRouter.setUserOverride()`

### ADR-004: Optional tmux Visual Layer

**Decision:** On macOS/Linux when tmux is detected, optionally mirror PTY output to tmux panes for visual monitoring. The orchestrator does NOT depend on tmux.

---

## 3. Current State Analysis

### What Works (Keep & Reuse)

| Component | Interface | Reuse |
|-----------|-----------|-------|
| `IModelProvider.chat()` | `IChatRequest` → `IChatResponse` | Supervisor LLM calls |
| `IModelProvider.stream()` | → `AsyncIterable<IStreamChunk>` | Streaming supervisor output |
| `ProviderRegistry.getForModel()` | `modelId` → `IModelProvider` | Resolve supervisor provider |
| `ModelRouter.resolve()` | `role?` → `IModelResolution` | Select supervisor model |
| `ToolRegistry.execute()` | `IToolCall, IToolExecutionContext` → `IToolResult` | Execute all tools |
| `ToolRegistry.getDefinitions()` | → `IToolDefinition[]` | Send tool schemas to LLM |
| `ToolRegistry.register()` | `IToolRegistration` → void | Register orchestration tools |
| `CostTracker.record()` | `provider, model, in, out, role` → `ITokenUsage` | Cost tracking |
| `CostTracker.isBudgetExceeded()` | → `boolean` | Budget enforcement |
| Auth, Config, SQLite, EventBus, Logger | (existing) | Reused as-is |

### What Gets Replaced

| Old | New | Why |
|-----|-----|-----|
| `TeamManager` (fork) | `OrchestratorEngine` (tool loop) | Cross-provider, cross-platform |
| `AgentProcess` (child_process) | `PtySessionManager` (node-pty) | Cross-platform, real-time I/O |
| `MessageBus` (in-memory) | `InboxManager` (SQLite + polling) | Persistence, idle detection |
| `IPC Hub` (Unix socket) | Direct function calls | Eliminated — in-process |

---

## 4. Target Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      AemeathCLI Process                        │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                 Orchestrator Engine                       │  │
│  │                                                          │  │
│  │  while (finishReason === "tool_calls" && step < max) {   │  │
│  │    response = IModelProvider.chat(IChatRequest)           │  │
│  │    for each toolCall in response.message.toolCalls:      │  │
│  │      result = ToolRegistry.execute(toolCall, context)    │  │
│  │  }                                                       │  │
│  │                                                          │  │
│  │  ToolRegistry contains:                                  │  │
│  │  ┌──────────────────┐  ┌───────────────────────────┐    │  │
│  │  │ Orchestration:   │  │ Built-in (existing):      │    │  │
│  │  │  handoff          │  │  read, write, edit, bash  │    │  │
│  │  │  assign           │  │  glob, grep, git          │    │  │
│  │  │  collect_results  │  │  web_fetch, web_search    │    │  │
│  │  │  send_message     │  │                           │    │  │
│  │  │  list_workers     │  │                           │    │  │
│  │  └────────┬─────────┘  └───────────────────────────┘    │  │
│  └───────────┼──────────────────────────────────────────────┘  │
│              │                                                 │
│  ┌───────────▼──────────────────────────────────────────────┐  │
│  │               PtySessionManager                          │  │
│  │  Map<terminalId, PtySession>                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │  │
│  │  │ Codex CLI   │  │ Claude CLI  │  │ Gemini CLI  │     │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │  │
│  └─────────┼────────────────┼────────────────┼─────────────┘  │
│  ┌─────────▼────────────────▼────────────────▼─────────────┐  │
│  │  macOS/Linux: Unix PTY  |  Windows: ConPTY              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  Existing: ProviderRegistry → ModelRouter → CostTracker        │
│            CredentialStore → ConfigStore → SQLite → EventBus   │
│                                                                │
│  Optional: TmuxOverlay (macOS/Linux, --visual flag)            │
└────────────────────────────────────────────────────────────────┘
```

### Request Lifecycle — Handoff

```
1. User: ac launch --agents supervisor --worker-provider codex

2. OrchestratorEngine starts:
   a. ModelRouter.resolve("planning") → { modelId: "claude-opus-4-6", provider: "anthropic" }
   b. ProviderRegistry.getForModel("claude-opus-4-6") → IModelProvider (Anthropic adapter)
   c. Register orchestration tools into ToolRegistry
   d. Enter tool loop

3. Supervisor LLM returns finishReason: "tool_calls"
   → toolCall: { name: "handoff", arguments: { agent_profile: "developer", message: "..." } }

4. ToolRegistry.execute(toolCall, context):
   a. handoff tool runs:
      → PtySessionManager.spawn() → pty.spawn(shell)
      → pty.write("codex --full-auto\r") → wait for idle
      → pty.write(task message) → poll until completed
      → extract response → destroy PTY
   b. Returns IToolResult { content: "developer's output", isError: false }

5. Result appended to messages → next loop iteration
6. Supervisor processes result, decides next action or gives final answer
```

---

## 5. Phase 0 — Foundation Fixes

> **Duration:** 1 day | **LOC:** ~200 changed

Fix 22 ESLint violations. Verify: `npm run clean && npm run build && npm run typecheck && npm run lint`

---

## 6. Phase 1 — PtySessionManager & State Layer

> **Estimated LOC:** ~950 new | **Duration:** 2-3 days | **Dependencies:** Phase 0

### 6.1 PtySessionManager (`src/orchestrator/pty/session-manager.ts`)

```typescript
import * as pty from "node-pty";
import { stripVTControlCharacters } from "node:util";
import { randomBytes } from "node:crypto";

const MAX_BUFFER_BYTES = 5 * 1024 * 1024;
const TAIL_BUFFER_LINES = 200;

interface PtySession {
  id: string;
  pty: pty.IPty;
  buffer: string;
  tailLines: string[];
  incompleteLine: string;
  provider: CliProviderType;
  agentProfile: string;
  alive: boolean;
  recentWrites: string[];       // Last N writes for echo filtering (not just last)
  createdAt: Date;
  disposables: pty.IDisposable[];
}

export class PtySessionManager {
  private readonly sessions = new Map<string, PtySession>();

  spawn(opts: SpawnOptions): PtySession {
    const id = randomBytes(4).toString("hex");

    const ptyProcess = pty.spawn(this.getShell(), this.getShellArgs(), {
      name: process.platform === "win32" ? undefined : "xterm-256color",
      cols: 200,
      rows: 50,
      cwd: opts.workingDirectory ?? process.cwd(),
      env: this.buildEnv(id),
    });

    const session: PtySession = {
      id, pty: ptyProcess, buffer: "", tailLines: [], incompleteLine: "",
      provider: opts.provider, agentProfile: opts.agentProfile ?? "unknown",
      alive: true, recentWrites: [], createdAt: new Date(), disposables: [],
    };

    // Stream output into capped buffer with proper line splitting
    const dataDisp = ptyProcess.onData((data: string) => {
      session.buffer += data;
      if (session.buffer.length > MAX_BUFFER_BYTES) {
        session.buffer = session.buffer.slice(-MAX_BUFFER_BYTES);
      }
      // Handle \r\n, \r, \n and partial lines across chunks
      const normalized = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const parts = (session.incompleteLine + normalized).split("\n");
      session.incompleteLine = parts.pop() ?? "";
      if (parts.length > 0) {
        session.tailLines.push(...parts);
        if (session.tailLines.length > TAIL_BUFFER_LINES) {
          session.tailLines = session.tailLines.slice(-TAIL_BUFFER_LINES);
        }
      }
    });
    session.disposables.push(dataDisp);

    // Handle exit with 200ms drain delay (Linux onExit-before-onData race)
    const exitDisp = ptyProcess.onExit(() => {
      setTimeout(() => { session.alive = false; }, 200);
    });
    session.disposables.push(exitDisp);

    this.sessions.set(id, session);
    return session;
  }

  /** Write input. Tracks recent writes for echo filtering. */
  write(id: string, data: string): void {
    const session = this.getSession(id);
    // Track non-trivial writes (not bare \r) for echo filtering
    const trimmed = data.replace(/\r$/g, "").trim();
    if (trimmed.length > 0) {
      session.recentWrites.push(trimmed);
      if (session.recentWrites.length > 10) session.recentWrites.shift();
    }
    session.pty.write(data);
  }

  /** Write text + carriage return. */
  async writeLine(id: string, text: string): Promise<void> {
    this.write(id, text + "\r");
  }

  /** Write with multiple enter keys (non-blocking delays). */
  async writeWithEnters(id: string, text: string, enterCount: number): Promise<void> {
    this.write(id, text);
    for (let i = 0; i < enterCount; i++) {
      if (i > 0) await sleep(300);
      this.getSession(id).pty.write("\r"); // Direct write — don't pollute recentWrites
    }
  }

  /** Get tail lines as clean text (ANSI stripped). */
  getCleanTail(id: string, lineCount?: number): string {
    const session = this.getSession(id);
    const lines = session.tailLines.slice(-(lineCount ?? TAIL_BUFFER_LINES));
    return stripVTControlCharacters(lines.join("\n"));
  }

  /** Get full output, ANSI stripped, with echo lines removed. */
  getFilteredOutput(id: string): string {
    const session = this.getSession(id);
    const clean = stripVTControlCharacters(session.buffer);
    if (session.recentWrites.length === 0) return clean;
    // Remove lines that exactly match any recent write (echo filtering)
    const echoSet = new Set(session.recentWrites);
    return clean.split("\n").filter(line => !echoSet.has(line.trim())).join("\n");
  }

  clearBuffer(id: string): void {
    const s = this.getSession(id);
    s.buffer = ""; s.tailLines = []; s.incompleteLine = "";
  }

  destroy(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (process.platform === "win32") {
      try { session.pty.write("\r"); } catch { /* ignore */ }
    }
    for (const d of session.disposables) d.dispose();
    try { session.pty.kill(); } catch { /* already dead */ }
    if (process.platform === "win32" && session.pty.pid) {
      setTimeout(() => { try { process.kill(session.pty.pid, "SIGKILL"); } catch {} }, 5_000);
    }
    this.sessions.delete(id);
  }

  destroyAll(): void { for (const id of [...this.sessions.keys()]) this.destroy(id); }
  list(): PtySession[] { return [...this.sessions.values()]; }
  getSession(id: string): PtySession {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`PTY session not found: ${id}`);
    return s;
  }

  private buildEnv(id: string): Record<string, string | undefined> {
    return {
      ...process.env, AC_TERMINAL_ID: id,
      ...(process.platform === "win32"
        ? { SystemRoot: process.env.SystemRoot, TERM: undefined }
        : { TERM: "xterm-256color" }),
    };
  }
  private getShell(): string {
    return process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : (process.env.SHELL ?? "/bin/bash");
  }
  private getShellArgs(): string[] { return process.platform === "win32" ? [] : ["-l"]; }
}
```

### 6.2 Optional TmuxOverlay (`src/orchestrator/pty/tmux-overlay.ts`)

```typescript
export class TmuxOverlay {
  private available: boolean;
  private sessionName: string | null = null;
  private outputQueues = new Map<string, string>();
  private flushTimer: NodeJS.Timer | null = null;

  constructor() {
    try { execSync("tmux -V", { stdio: "ignore" }); this.available = process.platform !== "win32"; }
    catch { this.available = false; }
  }

  isAvailable(): boolean { return this.available; }

  createSession(name: string): void {
    if (!this.isAvailable()) return;
    this.sessionName = name;
    execSync(`tmux new-session -d -s ${name} -x 200 -y 50`);
    this.flushTimer = setInterval(() => this.flushAll(), 100);
  }

  addWorkerPane(workerId: string, label: string, ptySession: PtySession): void {
    if (!this.isAvailable() || !this.sessionName) return;
    execSync(`tmux new-window -t ${this.sessionName} -n ${label}`);
    this.outputQueues.set(label, "");
    ptySession.pty.onData((data) => {
      this.outputQueues.set(label, (this.outputQueues.get(label) ?? "") + data);
    });
  }

  private flushAll(): void {
    if (!this.sessionName) return;
    for (const [label, data] of this.outputQueues) {
      if (data.length === 0) continue;
      this.outputQueues.set(label, "");
      const buf = `ac-${label.replace(/[^a-z0-9-]/gi, "")}`;
      try {
        execSync(`tmux load-buffer -b ${buf} -`, { input: data, stdio: ["pipe", "ignore", "ignore"] });
        execSync(`tmux paste-buffer -b ${buf} -t ${this.sessionName}:${label}`, { stdio: "ignore" });
        execSync(`tmux delete-buffer -b ${buf}`, { stdio: "ignore" });
      } catch { /* best effort */ }
    }
  }

  destroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.sessionName) { try { execSync(`tmux kill-session -t ${this.sessionName}`); } catch {} }
    this.sessionName = null; this.outputQueues.clear();
  }
}
```

### 6.3 StateStore (`src/orchestrator/state-store.ts`)

SQLite persistence for terminals and inbox messages. Uses existing `better-sqlite3`.

---

## 7. Phase 2 — CLI Provider Adapters

> **LOC:** ~1,200 new | **Duration:** 2-3 days | **Dependencies:** Phase 1

Note: These are called **CliProvider** (not "Provider") to avoid collision with the existing `IModelProvider` / `ProviderRegistry` which handle SDK API calls.

### 7.1 BaseCliProvider (`src/orchestrator/cli-providers/base-cli-provider.ts`)

```typescript
export abstract class BaseCliProvider {
  constructor(
    protected readonly terminalId: string,
    protected readonly sessionManager: PtySessionManager,
    protected readonly model?: string,  // For Ollama — model name
  ) {}

  abstract readonly enterCount: number;
  abstract readonly extractionRetries: number;
  abstract getStartCommand(): string;
  abstract getExitCommand(): string;
  abstract detectStatus(cleanOutput: string): TerminalStatus;
  abstract getIdlePattern(): RegExp;
  abstract extractLastResponse(cleanOutput: string): string;

  async initialize(): Promise<void> {
    await this.waitForShellReady();
    await this.sessionManager.writeLine(this.terminalId, this.getStartCommand());
    await this.waitUntilStatus(["idle", "completed"], PROVIDER_INIT_TIMEOUT_MS);
  }

  getStatus(): TerminalStatus {
    return this.detectStatus(this.sessionManager.getCleanTail(this.terminalId, TAIL_BUFFER_LINES));
  }

  async waitUntilStatus(targets: TerminalStatus[], timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = this.getStatus();
      if (targets.includes(status)) return true;
      if (status === "error") return false;
      await sleep(STATUS_POLL_INTERVAL_MS);
    }
    return false;
  }

  async sendTask(message: string): Promise<void> {
    await this.sessionManager.writeWithEnters(this.terminalId, message, this.enterCount);
  }

  async exit(): Promise<void> {
    const cmd = this.getExitCommand();
    if (cmd.startsWith("Ctrl-")) {
      const code = cmd.replace("Ctrl-", "").charCodeAt(0) - 64;
      this.sessionManager.getSession(this.terminalId).pty.write(String.fromCharCode(code));
    } else {
      await this.sessionManager.writeLine(this.terminalId, cmd);
    }
  }

  /** Extract response with retry — re-reads buffer on each attempt. */
  async extractWithRetry(): Promise<string> {
    for (let attempt = 0; attempt <= this.extractionRetries; attempt++) {
      try {
        const output = this.sessionManager.getFilteredOutput(this.terminalId);
        return this.extractLastResponse(output);
      } catch {
        if (attempt < this.extractionRetries) await sleep(5_000);
      }
    }
    // Fallback: return raw tail
    return this.sessionManager.getFilteredOutput(this.terminalId).slice(-MAX_OUTPUT_EXTRACT_BYTES);
  }

  private async waitForShellReady(): Promise<void> {
    let last = "", stable = 0;
    const start = Date.now();
    while (Date.now() - start < SHELL_READY_TIMEOUT_MS) {
      const out = this.sessionManager.getCleanTail(this.terminalId, 5);
      if (out.trim().length > 0 && out === last) { stable++; if (stable >= 2) return; }
      else stable = 0;
      last = out;
      await sleep(500);
    }
    throw new Error("Shell initialization timeout");
  }
}
```

### 7.2 Provider Implementations

#### ClaudeCodeCliProvider

```typescript
export class ClaudeCodeCliProvider extends BaseCliProvider {
  readonly enterCount = 2;
  readonly extractionRetries = 0;
  getStartCommand(): string { return "claude --dangerously-skip-permissions"; }
  getExitCommand(): string { return "/exit"; }
  getIdlePattern(): RegExp { return /[>❯][\s\xa0]/; }

  detectStatus(output: string): TerminalStatus {
    if (/Allow|Deny|approve/i.test(output)) return "waiting_user_answer";
    const last5 = output.split("\n").slice(-5).join("\n");
    const hasIdle = /[>❯][\s\xa0]/.test(last5);
    const hasResponse = /⏺/.test(output);
    if (hasIdle && hasResponse) return "completed";
    if (hasIdle) return "idle";
    return "processing";
  }

  extractLastResponse(output: string): string {
    const blocks = output.split(/⏺/);
    if (blocks.length < 2) throw new Error("No response marker found");
    return blocks[blocks.length - 1].replace(/\n[>❯][\s\xa0].*$/s, "").trim();
  }
}
```

#### CodexCliProvider

```typescript
export class CodexCliProvider extends BaseCliProvider {
  readonly enterCount = 2;
  readonly extractionRetries = 1;
  getStartCommand(): string { return "codex --full-auto"; }
  getExitCommand(): string { return "Ctrl-C"; }
  getIdlePattern(): RegExp { return /[❯›]|codex>/; }

  detectStatus(output: string): TerminalStatus {
    const last10 = output.split("\n").slice(-10).join("\n");
    const hasIdle = /[❯›]|codex>/.test(last10);
    const hasFooter = /tokens|cost|\$\d/i.test(last10);
    if (hasIdle && hasFooter) return "completed";
    if (hasIdle) return "idle";
    return "processing";
  }

  extractLastResponse(output: string): string {
    const idx = output.lastIndexOf("Assistant");
    if (idx === -1) throw new Error("No assistant response found");
    const response = output.slice(idx);
    const footerIdx = response.search(/tokens|cost|\$\d/i);
    return (footerIdx > 0 ? response.slice(0, footerIdx) : response).trim();
  }
}
```

#### GeminiCliProvider

```typescript
export class GeminiCliProvider extends BaseCliProvider {
  readonly enterCount = 1;
  readonly extractionRetries = 2; // TUI spinner
  getStartCommand(): string { return "gemini"; }
  getExitCommand(): string { return "/quit"; }
  getIdlePattern(): RegExp { return /[*◆✦]\s+Type your message/i; }

  detectStatus(output: string): TerminalStatus {
    const lastChunk = output.slice(-500);
    const hasIdle = /[*◆✦]\s+Type your message/i.test(lastChunk);
    const hasResponse = /✦/.test(output);
    if (hasIdle && hasResponse) return "completed";
    if (hasIdle) return "idle";
    return "processing";
  }

  extractLastResponse(output: string): string {
    const parts = output.split(/✦/);
    if (parts.length < 2) throw new Error("No Gemini response marker");
    return parts[parts.length - 1].replace(/[*◆]\s+Type your message.*$/s, "").trim();
  }
}
```

#### KimiCliProvider

```typescript
export class KimiCliProvider extends BaseCliProvider {
  readonly enterCount = 2;
  readonly extractionRetries = 0;
  getStartCommand(): string { return "kimi"; }
  getExitCommand(): string { return "/exit"; }
  getIdlePattern(): RegExp { return /^>\s/m; }

  detectStatus(output: string): TerminalStatus {
    const lastChunk = output.slice(-300);
    if (/^>\s/m.test(lastChunk) && output.length > 100) return "completed";
    if (/^>\s/m.test(lastChunk)) return "idle";
    return "processing";
  }

  extractLastResponse(output: string): string {
    const lines = output.split("\n");
    let start = -1, end = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^>\s/.test(lines[i])) {
        if (start === -1) end = i; else { start = i + 1; break; }
      }
    }
    return lines.slice(Math.max(start, 0), end).join("\n").trim();
  }
}
```

#### OllamaCliProvider

```typescript
export class OllamaCliProvider extends BaseCliProvider {
  readonly enterCount = 1;
  readonly extractionRetries = 0;
  getStartCommand(): string { return `ollama run ${this.model ?? "llama3"}`; }
  getExitCommand(): string { return "/bye"; }
  getIdlePattern(): RegExp { return /^>>>\s*/m; }

  detectStatus(output: string): TerminalStatus {
    const lastChunk = output.slice(-200);
    if (/^>>>\s*/m.test(lastChunk) && output.length > 50) return "completed";
    if (/^>>>\s*/m.test(lastChunk)) return "idle";
    return "processing";
  }

  extractLastResponse(output: string): string {
    const parts = output.split(/^>>>\s*/m);
    if (parts.length < 2) throw new Error("No Ollama response");
    return parts[parts.length - 1].trim();
  }
}
```

### 7.3 CliProviderManager (`src/orchestrator/cli-providers/cli-provider-manager.ts`)

```typescript
export class CliProviderManager {
  private readonly providers = new Map<string, BaseCliProvider>();

  create(type: CliProviderType, terminalId: string, sm: PtySessionManager, model?: string): BaseCliProvider {
    const p = this.instantiate(type, terminalId, sm, model);
    this.providers.set(terminalId, p);
    return p;
  }
  get(terminalId: string): BaseCliProvider | undefined { return this.providers.get(terminalId); }
  remove(terminalId: string): void { this.providers.delete(terminalId); }

  private instantiate(type: CliProviderType, tid: string, sm: PtySessionManager, model?: string): BaseCliProvider {
    switch (type) {
      case "claude-code": return new ClaudeCodeCliProvider(tid, sm);
      case "codex":       return new CodexCliProvider(tid, sm);
      case "gemini-cli":  return new GeminiCliProvider(tid, sm);
      case "kimi-cli":    return new KimiCliProvider(tid, sm);
      case "ollama":      return new OllamaCliProvider(tid, sm, model);
    }
  }
}
```

---

## 8. Phase 3 — In-Process Orchestrator Engine

> **LOC:** ~1,500 new | **Duration:** 3-4 days | **Dependencies:** Phase 1, Phase 2

### 8.1 WorkerManager (`src/orchestrator/worker-manager.ts`)

```typescript
export class WorkerManager {
  readonly state: StateStore;

  constructor(
    private readonly sessionManager: PtySessionManager,
    private readonly cliProviderManager: CliProviderManager,
    state: StateStore,
    readonly sessionId: string,
    readonly workingDirectory: string,  // Propagated to all workers
  ) { this.state = state; }

  async spawnWorker(opts: { agentProfile: string; provider: CliProviderType; model?: string }): Promise<WorkerInfo> {
    const existing = this.state.listTerminals(this.sessionId);
    if (existing.length >= MAX_WORKERS_PER_SESSION) throw new Error(`Max workers reached`);

    const session = this.sessionManager.spawn({
      provider: opts.provider, agentProfile: opts.agentProfile,
      workingDirectory: this.workingDirectory,  // Workers inherit session working dir
    });
    const cliProvider = this.cliProviderManager.create(opts.provider, session.id, this.sessionManager, opts.model);
    await cliProvider.initialize();
    this.state.createTerminal({
      id: session.id, sessionId: this.sessionId, provider: opts.provider,
      agentProfile: opts.agentProfile, status: "idle", createdAt: new Date(),
    });
    return { terminalId: session.id, provider: opts.provider, status: "idle" };
  }

  async sendTask(tid: string, message: string): Promise<void> {
    const p = this.cliProviderManager.get(tid);
    if (!p) throw new Error(`No CLI provider for: ${tid}`);
    await p.sendTask(message);
    this.state.updateTerminalStatus(tid, "processing");
  }

  getStatus(tid: string): TerminalStatus {
    return this.cliProviderManager.get(tid)?.getStatus() ?? "error";
  }

  async extractResponse(tid: string): Promise<string> {
    const p = this.cliProviderManager.get(tid);
    if (!p) throw new Error(`No CLI provider for: ${tid}`);
    return p.extractWithRetry();  // Re-reads buffer on each retry
  }

  async waitForCompletion(tid: string, timeoutMs: number): Promise<boolean> {
    const p = this.cliProviderManager.get(tid);
    if (!p) return false;
    return p.waitUntilStatus(["completed"], timeoutMs);
  }

  async destroyWorker(tid: string): Promise<void> {
    const p = this.cliProviderManager.get(tid);
    if (p) await p.exit();
    await sleep(1_000);
    this.sessionManager.destroy(tid);
    this.cliProviderManager.remove(tid);
    this.state.deleteTerminal(tid);
  }

  async destroyAll(): Promise<void> {
    const terminals = this.state.listTerminals(this.sessionId);
    await Promise.allSettled(terminals.map(t => this.destroyWorker(t.id)));
  }
}
```

### 8.2 Orchestration Tools as `IToolRegistration` (`src/orchestrator/tools/orchestration-tools.ts`)

Orchestration tools are registered as `IToolRegistration` objects into the existing `ToolRegistry`, making them first-class citizens alongside the built-in tools (read, write, bash, etc.).

```typescript
import type { IToolRegistration, IToolDefinition, IToolParameter, IToolCall, IToolResult } from "../../types/index.js";

export function createOrchestrationTools(
  workerManager: WorkerManager,
  profileLoader: ProfileLoader,
  defaultProvider: CliProviderType,
): IToolRegistration[] {
  return [
    // ── handoff ──
    {
      definition: {
        name: "handoff",
        description: "Delegate a task to a specialized agent and wait for the result. Use for sequential tasks.",
        parameters: [
          { name: "agent_profile", type: "string", description: "Agent profile (e.g. 'developer', 'reviewer')", required: true },
          { name: "message", type: "string", description: "Task description", required: true },
          { name: "provider", type: "string", description: "Override CLI provider", required: false, enum: CLI_PROVIDERS },
          { name: "timeout_seconds", type: "number", description: "Max wait seconds", required: false, default: 600 },
        ],
      },
      category: "shell" as ToolCategory,
      requiresApproval: () => false,
      execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
        const agentProfile = args.agent_profile as string;
        const message = args.message as string;
        const provider = (args.provider as CliProviderType) ?? profileLoader.resolveProvider(agentProfile, defaultProvider);
        const timeout = ((args.timeout_seconds as number) ?? 600) * 1000;

        const worker = await workerManager.spawnWorker({ agentProfile, provider });
        try {
          await workerManager.sendTask(worker.terminalId, message);
          const completed = await workerManager.waitForCompletion(worker.terminalId, timeout);
          if (!completed) {
            return { toolCallId: "", name: "handoff", content: JSON.stringify({ success: false, error: "Timed out" }), isError: true };
          }
          const output = await workerManager.extractResponse(worker.terminalId);
          return { toolCallId: "", name: "handoff", content: JSON.stringify({ success: true, output }), isError: false };
        } finally {
          await workerManager.destroyWorker(worker.terminalId);
        }
      },
    },

    // ── assign ──
    {
      definition: {
        name: "assign",
        description: "Spawn a parallel worker. Returns immediately. Use collect_results() later.",
        parameters: [
          { name: "agent_profile", type: "string", description: "Agent profile", required: true },
          { name: "message", type: "string", description: "Task description", required: true },
          { name: "provider", type: "string", description: "Override CLI provider", required: false, enum: CLI_PROVIDERS },
        ],
      },
      category: "shell" as ToolCategory,
      requiresApproval: () => false,
      execute: async (args): Promise<IToolResult> => {
        const agentProfile = args.agent_profile as string;
        const message = args.message as string;
        const provider = (args.provider as CliProviderType) ?? profileLoader.resolveProvider(agentProfile, defaultProvider);
        const worker = await workerManager.spawnWorker({ agentProfile, provider });
        await workerManager.sendTask(worker.terminalId, message);
        return {
          toolCallId: "", name: "assign", isError: false,
          content: JSON.stringify({ success: true, terminalId: worker.terminalId }),
        };
      },
    },

    // ── collect_results ──
    {
      definition: {
        name: "collect_results",
        description: "Wait for assigned workers to complete and collect results.",
        parameters: [
          { name: "terminal_ids", type: "string", description: "Comma-separated terminal IDs from assign()", required: true },
          { name: "timeout_seconds", type: "number", description: "Max wait seconds", required: false, default: 600 },
        ],
      },
      category: "shell" as ToolCategory,
      requiresApproval: () => false,
      execute: async (args): Promise<IToolResult> => {
        const ids = (args.terminal_ids as string).split(",").map(s => s.trim());
        const timeout = ((args.timeout_seconds as number) ?? 600) * 1000;
        const settled = await Promise.allSettled(ids.map(async (tid) => {
          const ok = await workerManager.waitForCompletion(tid, timeout);
          const output = ok ? await workerManager.extractResponse(tid) : undefined;
          await workerManager.destroyWorker(tid);
          return { terminalId: tid, success: ok, output, error: ok ? undefined : "Timed out" };
        }));
        const results = settled.map(s => s.status === "fulfilled" ? s.value
          : { terminalId: "?", success: false, error: String((s as any).reason) });
        return { toolCallId: "", name: "collect_results", isError: false, content: JSON.stringify({ results }) };
      },
    },

    // ── send_message ──
    {
      definition: {
        name: "send_message",
        description: "Send a message to a running worker. Delivered when idle, queued otherwise.",
        parameters: [
          { name: "terminal_id", type: "string", description: "Target terminal ID", required: true },
          { name: "message", type: "string", description: "Message content", required: true },
        ],
      },
      category: "shell" as ToolCategory,
      requiresApproval: () => false,
      execute: async (args): Promise<IToolResult> => {
        const tid = args.terminal_id as string;
        const msg = args.message as string;
        const status = workerManager.getStatus(tid);
        if (status === "idle" || status === "completed") {
          await workerManager.sendTask(tid, msg);
          return { toolCallId: "", name: "send_message", isError: false, content: JSON.stringify({ delivered: true }) };
        }
        const msgId = workerManager.state.queueMessage({ from: "supervisor", to: tid, content: msg });
        return { toolCallId: "", name: "send_message", isError: false, content: JSON.stringify({ queued: true, messageId: msgId }) };
      },
    },

    // ── list_workers ──
    {
      definition: {
        name: "list_workers",
        description: "List all active workers with status and profile.",
        parameters: [],
      },
      category: "shell" as ToolCategory,
      requiresApproval: () => false,
      execute: async (): Promise<IToolResult> => {
        const terminals = workerManager.state.listTerminals(workerManager.sessionId);
        const workers = terminals.map(t => ({
          terminalId: t.id, agentProfile: t.agentProfile,
          provider: t.provider, status: workerManager.getStatus(t.id),
        }));
        return { toolCallId: "", name: "list_workers", isError: false, content: JSON.stringify({ workers }) };
      },
    },
  ];
}
```

### 8.3 Required Type Extension

`IChatMessage` currently lacks a `toolCallId` field. Tool result messages need this to associate results with their calls. This is a **one-line addition** to the existing type:

```typescript
// In src/types/message.ts — add to IChatMessage:
interface IChatMessage {
  // ... existing fields ...
  readonly toolCallId?: string | undefined;  // NEW — links tool results to calls
}
```

This is needed because: when the supervisor calls 3 tools in parallel, each `IToolResult` must map back to its `IToolCall.id`. The provider adapters (which convert `IChatMessage[]` to the underlying SDK format) need this field to build the correct request.

### 8.4 OrchestratorEngine (`src/orchestrator/engine.ts`)

```typescript
import type { IModelProvider } from "../providers/types.js";
import type { IChatRequest, IChatResponse, IChatMessage, IStreamChunk } from "../types/message.js";
import type { IToolRegistry, IToolExecutionContext, PermissionMode } from "../types/tool.js";
import type { ProviderName, ModelRole } from "../types/index.js";

/** Run options for the orchestrator. */
export interface RunOptions {
  readonly supervisorProfile?: string;
  readonly supervisorModel?: string;
  readonly defaultWorkerProvider?: CliProviderType;
  readonly workingDirectory?: string;
  readonly visual?: boolean;
  readonly maxSteps?: number;
}

/** Orchestrator result. */
export interface OrchestratorResult {
  readonly output: string;
  readonly steps: number;
  readonly totalCost: number;
}

/** Explicit dependency interface — all 12 fields typed. */
export interface OrchestratorDeps {
  readonly sessionManager: PtySessionManager;
  readonly cliProviderManager: CliProviderManager;
  readonly state: StateStore;
  readonly providerRegistry: ProviderRegistry;
  readonly modelRouter: ModelRouter;
  readonly toolRegistry: IToolRegistry;
  readonly costTracker: CostTracker;
  readonly profileLoader: ProfileLoader;
  readonly config: IGlobalConfig;
  readonly eventBus: EventBus;
  readonly sessionId: string;
  readonly workingDirectory: string;
}

export class OrchestratorEngine {
  private readonly workerManager: WorkerManager;
  private readonly tmuxOverlay: TmuxOverlay;
  private inboxTimer: NodeJS.Timer | null = null;
  private orchestrationToolsRegistered = false;

  constructor(private readonly deps: OrchestratorDeps) {
    this.workerManager = new WorkerManager(
      deps.sessionManager, deps.cliProviderManager, deps.state,
      deps.sessionId, deps.workingDirectory,
    );
    this.tmuxOverlay = new TmuxOverlay();
  }

  /** Run orchestrator — single-shot mode. Manages full lifecycle. */
  async run(task: string, opts: RunOptions): Promise<OrchestratorResult> {
    this.startSession(opts);
    const { sdkProvider, resolution, systemPrompt, toolDefs, toolContext } = this.prepareSession(opts);
    const messages: IChatMessage[] = [];
    const maxSteps = opts.maxSteps ?? MAX_ORCHESTRATOR_STEPS;

    // Consume the stream, collect final output
    let output = "";
    for await (const chunk of this.streamTask(
      task, sdkProvider, resolution, systemPrompt, toolDefs, toolContext, messages, maxSteps,
    )) {
      if (chunk.type === "text" && chunk.content) output += chunk.content;
    }

    // If no streamed text, get from last assistant message
    if (!output) {
      const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
      output = lastAssistant?.content ?? "";
    }

    await this.stopSession();
    this.deps.eventBus.emit("orchestrator:completed", { totalCost: this.deps.costTracker.getSessionTotal() });
    return { output, steps: messages.filter(m => m.role === "assistant").length, totalCost: this.deps.costTracker.getSessionTotal() };
  }

  /**
   * Stream a single task. Yields text chunks and handles tools between rounds.
   * Does NOT manage lifecycle (inbox, workers, tmux) — caller is responsible.
   * This allows REPL mode to call streamTask() per-message without killing workers.
   */
  private async *streamTask(
    task: string,
    sdkProvider: IModelProvider,
    resolution: { modelId: string; provider: string },
    systemPrompt: string,
    toolDefs: readonly IToolDefinition[],
    toolContext: IToolExecutionContext,
    messages: IChatMessage[],
    maxSteps: number,
  ): AsyncGenerator<IStreamChunk> {
    messages.push(this.createMessage("user", task));

    let step = 0;
    while (step < maxSteps) {
      const request: IChatRequest = { model: resolution.modelId, messages, system: systemPrompt, tools: toolDefs };

      let fullContent = "";
      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

      for await (const chunk of sdkProvider.stream(request)) {
        if (chunk.type === "text" && chunk.content) {
          fullContent += chunk.content;
          yield chunk;
        }
        if (chunk.type === "tool_call" && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
        }
        if (chunk.type === "usage" && chunk.usage) {
          this.deps.costTracker.record(
            resolution.provider as ProviderName, resolution.modelId,
            chunk.usage.inputTokens, chunk.usage.outputTokens,
            "planning" as ModelRole,
          );
        }
      }

      const assistantMsg = this.createMessage("assistant", fullContent);
      messages.push(toolCalls.length > 0
        ? { ...assistantMsg, toolCalls } as IChatMessage
        : assistantMsg
      );

      if (toolCalls.length === 0) break;
      if (this.deps.costTracker.isBudgetExceeded()) break;

      for (const call of toolCalls) {
        const result = await this.deps.toolRegistry.execute(
          { id: call.id, name: call.name, arguments: call.arguments }, toolContext,
        );
        const content = result.content.length > MAX_OUTPUT_EXTRACT_BYTES
          ? result.content.slice(0, MAX_OUTPUT_EXTRACT_BYTES) + "\n[truncated]"
          : result.content;
        messages.push(this.createMessage("tool", content, call.id));
      }
      step++;
    }
    yield { type: "done" };
  }

  /**
   * Prepare shared resources for a session. Called once at session start.
   * Returns the resolved provider, prompts, and context needed for streamTask().
   */
  private prepareSession(opts: RunOptions) {
    if (opts.supervisorModel) this.deps.modelRouter.setUserOverride(opts.supervisorModel);
    const resolution = this.deps.modelRouter.resolve("planning" as ModelRole);
    const sdkProvider = this.deps.providerRegistry.getForModel(resolution.modelId);
    this.ensureToolsRegistered(opts.defaultWorkerProvider ?? DEFAULT_CLI_PROVIDER);
    const toolDefs = this.deps.toolRegistry.getDefinitions();
    const profile = this.deps.profileLoader.load(opts.supervisorProfile ?? "supervisor");
    const systemPrompt = this.buildSystemPrompt(profile, opts);
    const toolContext: IToolExecutionContext = {
      workingDirectory: this.deps.workingDirectory,
      permissionMode: (this.deps.config.permissions.mode ?? "standard") as PermissionMode,
      projectRoot: this.deps.workingDirectory,
      allowedPaths: [...(this.deps.config.permissions.allowedPaths ?? ["./"])],
      blockedCommands: [...(this.deps.config.permissions.blockedCommands ?? [])],
    };
    return { sdkProvider, resolution, systemPrompt, toolDefs, toolContext };
  }

  /** Start session lifecycle: inbox delivery, optional tmux overlay. */
  startSession(opts: RunOptions): void {
    if (opts.visual && this.tmuxOverlay.isAvailable()) {
      this.tmuxOverlay.createSession(`ac-${opts.supervisorProfile}`);
    }
    this.inboxTimer = this.startInboxDelivery();
  }

  /** Stop session lifecycle: inbox, workers, tmux. */
  async stopSession(): Promise<void> {
    this.stopInboxDelivery();
    await this.workerManager.destroyAll();
    this.tmuxOverlay.destroy();
  }

  /** Interactive REPL — lifecycle managed here, NOT in streamTask(). */
  async repl(opts: RunOptions): Promise<void> {
    this.startSession(opts);
    const { sdkProvider, resolution, systemPrompt, toolDefs, toolContext } = this.prepareSession(opts);
    const messages: IChatMessage[] = []; // Persistent across turns
    const maxSteps = opts.maxSteps ?? MAX_ORCHESTRATOR_STEPS;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
    console.log(`AemeathCLI Orchestrator | Profile: ${opts.supervisorProfile}`);
    console.log(`Type a task. /workers to list. /quit to exit.\n`);
    rl.prompt();

    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed === "/quit") break;
      if (trimmed === "/workers") {
        const terminals = this.workerManager.state.listTerminals(this.workerManager.sessionId);
        console.table(terminals.map(t => ({
          id: t.id, profile: t.agentProfile, status: this.workerManager.getStatus(t.id),
        })));
        rl.prompt();
        continue;
      }
      if (trimmed.length === 0) { rl.prompt(); continue; }

      // Stream one task — workers persist between turns
      for await (const chunk of this.streamTask(
        trimmed, sdkProvider, resolution, systemPrompt, toolDefs, toolContext, messages, maxSteps,
      )) {
        if (chunk.type === "text" && chunk.content) process.stdout.write(chunk.content);
      }
      console.log("\n");
      rl.prompt();
    }

    rl.close();
    await this.stopSession(); // Cleanup only when REPL exits
  }

  setupSignalHandlers(): void {
    const cleanup = async () => {
      this.stopInboxDelivery();
      await this.workerManager.destroyAll();
      this.tmuxOverlay.destroy();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  // ── Private ──

  /** Register orchestration tools ONCE into the shared ToolRegistry. */
  private ensureToolsRegistered(defaultWorkerProvider: CliProviderType): void {
    if (this.orchestrationToolsRegistered) return;
    const orchTools = createOrchestrationTools(this.workerManager, this.deps.profileLoader, defaultWorkerProvider);
    for (const tool of orchTools) this.deps.toolRegistry.register(tool);
    this.orchestrationToolsRegistered = true;
  }

  private startInboxDelivery(): NodeJS.Timer {
    return setInterval(async () => {
      for (const t of this.workerManager.state.listTerminals(this.workerManager.sessionId)) {
        const status = this.workerManager.getStatus(t.id);
        if (status !== "idle" && status !== "completed") continue;
        const pending = this.workerManager.state.getPendingMessages(t.id);
        if (pending.length === 0) continue;
        try {
          await this.workerManager.sendTask(t.id, pending[0].content);
          this.workerManager.state.markDelivered(pending[0].id);
        } catch { this.workerManager.state.markFailed(pending[0].id); }
      }
    }, INBOX_POLL_INTERVAL_MS);
  }

  private stopInboxDelivery(): void {
    if (this.inboxTimer) { clearInterval(this.inboxTimer); this.inboxTimer = null; }
  }

  /** Create an IChatMessage. Uses the new toolCallId field for tool result messages. */
  private createMessage(role: "user" | "tool" | "assistant", content: string, toolCallId?: string): IChatMessage {
    return {
      id: randomUUID(),
      role,
      content,
      createdAt: new Date(),
      // toolCallId links tool result messages to their originating IToolCall
      // This requires the IChatMessage extension described in Section 8.3
      ...(toolCallId !== undefined ? { toolCallId } : {}),
    };
  }

  private buildSystemPrompt(profile: AgentProfile, opts: RunOptions): string {
    return `${profile.systemPrompt}

## Available Agent Profiles
${this.deps.profileLoader.listProfiles().map(p => `- ${p.name}: ${p.description}`).join("\n")}

## Orchestration Tools
- handoff(agent_profile, message) — delegate task, wait for result (sequential)
- assign(agent_profile, message) — spawn parallel worker, returns immediately
- collect_results(terminal_ids) — gather outputs from assigned workers
- send_message(terminal_id, message) — message a running worker
- list_workers() — show active workers

## Guidelines
- Use handoff() for tasks where you need the result before proceeding
- Use assign() + collect_results() for independent parallel tasks
- Workers are independent CLI agents with full file/bash access in ${opts.workingDirectory ?? process.cwd()}`;
  }
}
```

---

## 9. Phase 4 — Agent Profiles & Store

> **Duration:** 1-2 days | **LOC:** ~600 new

8 built-in Markdown+YAML profiles in `src/orchestrator/agent-store/`:

| Profile | Default Provider | Purpose |
|---------|-----------------|---------|
| `supervisor.md` | (SDK via ModelRouter) | Decompose, delegate, synthesize |
| `developer.md` | codex | Code implementation |
| `reviewer.md` | claude-code | Code review, security |
| `tester.md` | gemini-cli | Test writing, execution |
| `researcher.md` | gemini-cli | Analysis, documentation research |
| `debugger.md` | claude-code | Bug diagnosis, fixing |
| `documenter.md` | gemini-cli | README, API docs |
| `architect.md` | claude-code | System design |

**ProfileLoader** (`src/orchestrator/profiles/profile-loader.ts`):
```typescript
export class ProfileLoader {
  load(name: string): AgentProfile;           // ~/.aemeathcli/agent-store/ → built-in fallback
  listProfiles(): AgentProfile[];             // All available
  install(source: string): Promise<string>;   // From file or URL
  resolveProvider(name: string, fallback: CliProviderType): CliProviderType;
}
```

---

## 10. Phase 5 — CLI Commands & UX

> **Duration:** 2 days | **LOC:** ~800 new

### Commands

```
ac launch --agents <profile> [--worker-provider <name>] [--supervisor-model <model>] [--visual] [--task <msg>]
ac shutdown [--all | --session <id>]
ac info [--sessions | --workers | --providers | --profiles]
ac install <file.md | url>
```

- `--worker-provider`: Default CLI provider for workers (default: `claude-code`)
- `--supervisor-model`: Override supervisor model (default: resolved by `ModelRouter.resolve("planning")`)
- `--visual`: Pipe worker output to tmux panes (macOS/Linux only)

### Provider Detection (cross-platform)

```typescript
function detectInstalledProviders(): CliProviderType[] {
  const commands: Record<CliProviderType, string[]> = {
    "claude-code": ["claude", "--version"],
    "codex":       ["codex", "--version"],
    "gemini-cli":  ["gemini", "--version"],
    "kimi-cli":    ["kimi", "--version"],
    "ollama":      ["ollama", "--version"],
  };
  const available: CliProviderType[] = [];
  for (const [provider, [cmd, ...args]] of Object.entries(commands)) {
    try {
      const result = spawnSync(cmd, args, {
        stdio: "ignore", timeout: 5000,
        shell: process.platform === "win32",  // Required to resolve .cmd wrappers on Windows
      });
      if (result.status === 0) available.push(provider as CliProviderType);
    } catch { /* not installed */ }
  }
  return available;
}
```

---

## 11. Phase 6 — Observability & Guardrails

> **Duration:** 1-2 days | **LOC:** ~400 new

### Guardrails

| Guardrail | Default | Where Enforced |
|-----------|---------|---------------|
| Max workers per session | 10 | `WorkerManager.spawnWorker()` |
| Max orchestrator steps | 30 | Tool loop `while` condition |
| Max handoff depth | 5 | Track via counter in engine |
| Handoff timeout | 600s | `handoff` tool parameter |
| Budget hard stop | $20 | `CostTracker.isBudgetExceeded()` after each LLM call |
| PTY buffer cap | 5MB | `PtySessionManager.onData()` |
| Tool result truncation | 100KB | Engine tool loop — prevents context overflow |
| Output extract limit | 100KB | `WorkerManager.extractResponse()` |
| Windows kill timeout | 5s | `PtySessionManager.destroy()` |
| onExit drain delay | 200ms | `PtySessionManager.spawn()` |

### Events (extend existing EventBus)

```
"orchestrator:started"           → { sessionId, profile, provider }
"orchestrator:step"              → { step, toolCalls }
"orchestrator:handoff:start"     → { workerTid, profile }
"orchestrator:handoff:done"      → { workerTid, durationMs, success }
"orchestrator:assign"            → { workerTid, profile }
"orchestrator:collect"           → { terminalIds, results }
"orchestrator:message:queued"    → { from, to }
"orchestrator:message:delivered"  → { to, messageId }
"orchestrator:budget:warning"    → { cost, threshold }
"orchestrator:completed"         → { steps, totalCost }
```

---

## 12. Phase 7 — Testing & Hardening

> **Duration:** 3 days | **LOC:** ~2,500 new

### Test Structure

```
tests/orchestrator/
├── pty/
│   ├── session-manager.test.ts        # Mock node-pty
│   ├── session-manager.integration.ts # Real PTY on all platforms
│   └── tmux-overlay.test.ts
├── cli-providers/
│   ├── claude-code-cli-provider.test.ts  # Fixture-based status detection
│   ├── codex-cli-provider.test.ts
│   ├── gemini-cli-provider.test.ts
│   ├── kimi-cli-provider.test.ts
│   └── cli-provider-manager.test.ts
├── tools/
│   ├── handoff.test.ts
│   ├── assign.test.ts
│   ├── collect-results.test.ts
│   └── send-message.test.ts
├── engine.test.ts                     # Mock IModelProvider.chat() and .stream()
├── worker-manager.test.ts
├── state-store.test.ts                # In-memory SQLite
├── profiles/profile-loader.test.ts
└── fixtures/
    ├── claude-code/                    # Captured PTY output (with ANSI)
    ├── codex/
    ├── gemini-cli/
    └── kimi-cli/
```

### CI Matrix

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    node: [18, 20, 22]
```

---

## 13. File-by-File Implementation Map

```
src/orchestrator/
├── constants.ts                              # Phase 1 — ~50 LOC
├── index.ts                                  # Barrel export
├── pty/
│   ├── session-manager.ts                    # Phase 1 — ~400 LOC
│   ├── tmux-overlay.ts                       # Phase 1 — ~100 LOC
│   └── ansi.ts                               # Phase 1 — ~20 LOC
├── state-store.ts                            # Phase 1 — ~250 LOC
├── cli-providers/                            # Phase 2 (renamed from providers/)
│   ├── base-cli-provider.ts                  # ~200 LOC
│   ├── claude-code-cli-provider.ts           # ~80 LOC
│   ├── codex-cli-provider.ts                 # ~80 LOC
│   ├── gemini-cli-provider.ts                # ~80 LOC
│   ├── kimi-cli-provider.ts                  # ~70 LOC
│   ├── ollama-cli-provider.ts                # ~60 LOC
│   └── cli-provider-manager.ts               # ~60 LOC
├── tools/
│   └── orchestration-tools.ts                # Phase 3 — ~300 LOC (IToolRegistration[])
├── engine.ts                                 # Phase 3 — ~350 LOC
├── worker-manager.ts                         # Phase 3 — ~200 LOC
├── profiles/profile-loader.ts                # Phase 4 — ~150 LOC
├── agent-store/*.md                          # Phase 4 — 8 profiles
└── utils/helpers.ts                          # Phase 1 — ~40 LOC
```

**Total: ~6,040 LOC**

---

## 14. Data Models & Schema

### SQLite Schema (`~/.aemeathcli/db/orchestrator.db`)

```sql
CREATE TABLE IF NOT EXISTS terminals (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    agent_profile TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    receiver TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_terminals_session ON terminals(session_id);
CREATE INDEX IF NOT EXISTS idx_inbox_receiver ON inbox(receiver, status);
```

### TypeScript Types

```typescript
export type TerminalStatus = "idle" | "processing" | "completed" | "waiting_user_answer" | "error";
export type CliProviderType = "claude-code" | "codex" | "gemini-cli" | "kimi-cli" | "ollama";

export const SDK_FOR_CLI: Record<CliProviderType, ProviderName> = {
  "claude-code": "anthropic", "codex": "openai", "gemini-cli": "google",
  "kimi-cli": "kimi", "ollama": "ollama",
};

export interface TerminalRecord {
  id: string; sessionId: string; provider: CliProviderType;
  agentProfile?: string; status: TerminalStatus; createdAt: Date;
}
export interface InboxMessage {
  id: number; sender: string; receiver: string; content: string;
  status: "pending" | "delivered" | "failed"; createdAt: Date; deliveredAt?: Date;
}
export interface AgentProfile {
  name: string; description: string; provider?: CliProviderType; systemPrompt: string;
}
export interface WorkerInfo {
  terminalId: string; provider: CliProviderType; status: TerminalStatus;
}
```

---

## 15. Orchestration Tool Specifications

| Tool | Type | Parameters | Returns | Cleanup |
|------|------|-----------|---------|---------|
| `handoff` | Sync blocking | `agent_profile` (str, req), `message` (str, req), `provider` (str), `timeout_seconds` (num, 600) | `{ success, output?, error? }` | Worker destroyed |
| `assign` | Async non-blocking | `agent_profile` (str, req), `message` (str, req), `provider` (str) | `{ success, terminalId }` | Persists until `collect_results` |
| `collect_results` | Sync blocking | `terminal_ids` (str, comma-sep, req), `timeout_seconds` (num, 600) | `{ results: [{terminalId, success, output?}] }` | All workers destroyed |
| `send_message` | Async non-blocking | `terminal_id` (str, req), `message` (str, req) | `{ delivered }` or `{ queued, messageId }` | Delivered via inbox loop |
| `list_workers` | Instant | (none) | `{ workers: [{terminalId, profile, status}] }` | — |

---

## 16. Platform-Specific Behavior

| Aspect | macOS | Linux | Windows |
|--------|-------|-------|---------|
| Shell | `$SHELL` or `/bin/zsh` | `$SHELL` or `/bin/bash` | `%COMSPEC%` or `cmd.exe` |
| PTY | Unix PTY (`/dev/ptmx`) | Unix PTY (`/dev/ptmx`) | ConPTY (`CreatePseudoConsole`) |
| tmux overlay | Available | Available | Not available |
| `pty.kill()` | Standard | Standard | Send `\r` first; 5s force-kill fallback |
| ANSI | `stripVTControlCharacters()` | `stripVTControlCharacters()` | Extra ConPTY sequences — same function handles |
| `TERM` env | `xterm-256color` | `xterm-256color` | Unset (avoid Git Bash issues) |
| `SystemRoot` | N/A | N/A | Must be set in PTY env |
| Provider detection | `spawnSync` | `spawnSync` | `spawnSync` with `shell: true` (.cmd resolution) |
| PTY limit | Unlimited (practical) | 4096 default | No known limit |

---

## 17. Migration Strategy

Additive. New `ac launch` alongside existing `ac chat`, `ac plan`, `ac review`.

| Phase | Action |
|-------|--------|
| v2.0 | `ac launch` available. `ac team` prints deprecation warning. |
| v3.0 | `src/teams/` removed. |

---

## 18. Dependency Changes

### New: 1 dependency

| Package | Version | By | Downloads |
|---------|---------|------|----------|
| `node-pty` | `^1.1.0` | Microsoft | ~1.3M/week |

Build requirements (if prebuilts unavailable): macOS: Xcode. Linux: `build-essential`. Windows: `windows-build-tools`.

No framework dependencies added. The `ai` package (v4.3.19) is used indirectly through existing provider adapters only.

---

## 19. Risk Analysis & Mitigations

| Risk | Platform | Mitigation |
|------|----------|------------|
| ConPTY ANSI mangling | Windows | `stripVTControlCharacters()`; test all shells |
| `pty.kill()` hangs | Windows | `\r` before kill; 5s force-kill via `process.kill()` |
| Missing `SystemRoot` | Windows | Always inject in PTY env |
| `.cmd` resolution | Windows | `shell: true` in `spawnSync` |
| `onExit` before final `onData` | Linux | 200ms drain delay |
| PTY limit exhaustion | Linux | Max 10 workers; warn on low limit |
| node-pty compilation failure | All | Prebuilts cover most cases; document build reqs |
| Echo in output buffer | All | `recentWrites[]` tracking + `getFilteredOutput()` |
| Buffer OOM | All | 5MB cap per PTY session |
| Provider CLI update breaks regex | All | Configurable patterns via profile; log raw output on failure |
| Context window overflow | All | Tool results truncated at 100KB; `maxSteps=30` |
| Orphan PTY on crash | All | `SIGINT`/`SIGTERM` handlers |
| `IChatMessage` shape drift | All | `createMessage()` helper — single update point |
| Inbox race (send during extraction) | All | Status check before delivery in inbox loop |
| Tools re-registered in REPL | All | `ensureToolsRegistered()` with flag — runs once |

---

## 20. Success Criteria

### Functional

| # | Requirement | Platforms |
|---|------------|-----------|
| F1 | `ac launch --task` runs single-shot orchestration | All |
| F2 | `ac launch` enters REPL with persistent workers | All |
| F3 | `handoff()` delegates and returns result | All |
| F4 | `assign()` + `collect_results()` run parallel workers | All |
| F5 | `send_message()` delivers when idle, queues when busy | All |
| F6 | Workers persist between REPL turns (assign → later collect) | All |
| F7 | Cross-provider (Claude supervisor → Codex developer → Gemini tester) | All |
| F8 | Budget enforcement stops session | All |
| F9 | `--visual` shows tmux panes | macOS, Linux |
| F10 | SIGINT/SIGTERM cleanup — no orphan PTYs | All |

### Non-Functional

| # | Requirement | Target |
|---|------------|--------|
| NF1 | Worker spawn time | < 3s (PTY) + provider init |
| NF2 | Provider init time | < 30s |
| NF3 | Status detection accuracy | > 95% on fixture tests |
| NF4 | Unit test coverage | > 80% |
| NF5 | CI passes on macOS, Linux, Windows | All green |
| NF6 | Memory per session (5 workers) | < 150MB |

### Timeline: ~20 working days

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 0: Foundation | 1 day | 1 |
| 1: PTY + State | 2-3 days | 4 |
| 2: CLI Providers | 2-3 days | 7 |
| 3: Engine | 3-4 days | 11 |
| 4: Profiles | 1-2 days | 13 |
| 5: CLI | 2 days | 15 |
| 6: Guardrails | 1-2 days | 17 |
| 7: Testing | 3 days | 20 |

### Milestones

- **M1 (Day 4):** PtySessionManager spawns shells on all 3 platforms. StateStore CRUD works.
- **M2 (Day 7):** CLI providers detect idle/completed for Claude Code and Codex via PTY buffer.
- **M3 (Day 11):** Full handoff/assign/collect_results working. Cross-provider orchestration.
- **M4 (Day 15):** All CLI commands. REPL with persistent workers. `--visual` tmux overlay.
- **M5 (Day 20):** CI green on all platforms. Test suite passing. Ready for beta.

---

## Appendix A: Architecture Evolution

This plan went through several iterations to arrive at the final architecture:

| Approach | Rejected Because |
|----------|-----------------|
| HTTP server (Fastify) + MCP tools + tmux | Over-engineered; 3 new deps; no Windows |
| In-process + tmux only | No Windows support |
| In-process + node-pty + Vercel AI SDK framework | Unnecessary framework dependency; bypasses existing `IModelProvider`/`ToolRegistry` |
| **In-process + node-pty + existing interfaces** | **Final choice** — zero framework deps, cross-platform, uses existing codebase infrastructure |

## Appendix B: Research Sources

- [node-pty (Microsoft)](https://github.com/microsoft/node-pty) — powers VS Code
- [ConPTY](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/)
- [Braintrust — "The canonical agent architecture"](https://www.braintrust.dev/blog/agent-while-loop)
- [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/multi_agent/)
- [AWS CLI Agent Orchestrator](https://github.com/awslabs/cli-agent-orchestrator)
