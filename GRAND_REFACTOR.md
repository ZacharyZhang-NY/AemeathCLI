# Aemeath CLI — Grand Refactor Architecture

> Engineering blueprint. Not a roadmap. Not a vision. A concrete plan of what to build, how the pieces connect, and why.

---

## 0. The Problem with the Current Codebase

AemeathCLI right now has three layers that are all doing overlapping things:

- `src/providers/` — custom LLM adapter system
- `src/core/model-router.ts` — reinventing model resolution
- `src/auth/` — reinventing OAuth credential management
- `src/orchestrator/` — reinventing agent loop

pi-mono already solved all of these correctly. It has:
- A clean, typed streaming protocol (`@pi/ai`)
- A working agent loop with tool calling (`@pi/agent`)
- OAuth with auto-refresh, file locking, distributed coordination (`@pi/coding-agent/auth-storage`)
- An extension system for custom providers and hooks

The refactor: **delete our reimplementations, use pi-mono's foundation, build Aemeath's differentiators on top**.

What Aemeath adds that pi-mono doesn't have:
1. Cross-platform split-panel terminal (tmux/iTerm2/Ghostty/Terminal.app)
2. Multi-agent coordination with typed IPC (JSON-RPC 2.0)
3. Agent Teams with role-based model assignment
4. Role-based model routing across providers
5. MCP bridge

These stay. The plumbing underneath gets replaced.

---

## 1. Dependency Graph

```
                    ┌─────────────────────────────────────┐
                    │           @pi/ai                     │
                    │  All LLM providers, streaming        │
                    │  protocol, OAuth, model types        │
                    └─────────────────┬───────────────────┘
                                      │
                    ┌─────────────────▼───────────────────┐
                    │           @pi/agent                  │
                    │  Agent loop, tool calling,           │
                    │  message types, AgentState           │
                    └─────────────────┬───────────────────┘
                                      │
                    ┌─────────────────▼───────────────────┐
                    │      @pi/coding-agent (core)         │
                    │  AgentSession, auth-storage,         │
                    │  model-registry, extension runner,   │
                    │  session manager, slash commands     │
                    └─────────────────┬───────────────────┘
                                      │
          ┌───────────────────────────▼─────────────────────────────┐
          │                   Aemeath Core Layer                     │
          │                                                           │
          │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
          │  │   Tools      │  │   Teams      │  │  Panes         │  │
          │  │  (ported to  │  │  (agent IPC  │  │  (tmux/iterm2  │  │
          │  │  AgentTool)  │  │   protocol)  │  │   unchanged)   │  │
          │  └─────────────┘  └──────────────┘  └────────────────┘  │
          │                                                           │
          │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
          │  │   MCP        │  │   Skills     │  │   Config       │  │
          │  │  (AgentTool  │  │  (pi-mono    │  │  (merged       │  │
          │  │   bridge)    │  │   extension  │  │   schema)      │  │
          │  └─────────────┘  └──────────────┘  └────────────────┘  │
          └───────────────────────────┬─────────────────────────────┘
                                      │
                    ┌─────────────────▼───────────────────┐
                    │              CLI / TUI               │
                    │  Commander.js + Ink/React TUI        │
                    │  unchanged surface, new internals    │
                    └─────────────────────────────────────┘
```

---

## 2. New File Structure

```
src/
├── core/
│   ├── session.ts              # Thin wrapper around @pi/coding-agent AgentSession
│   ├── model-registry.ts       # Re-export @pi/coding-agent ModelRegistry + Aemeath overrides
│   ├── auth.ts                 # Re-export @pi/coding-agent auth-storage
│   ├── event-bus.ts            # Keep: typed global event bus
│   ├── cost-tracker.ts         # Keep: cost tracking on top of Usage events
│   └── context-manager.ts      # DELETED: pi-mono handles context via compaction
│
├── tools/
│   ├── types.ts                # AemeathAgentTool: extends AgentTool with permission metadata
│   ├── registry.ts             # Builds AgentTool[] list, wires approval hooks
│   ├── read.ts                 # Implements AgentTool interface (was IToolRegistration)
│   ├── write.ts
│   ├── edit.ts
│   ├── glob.ts
│   ├── grep.ts
│   ├── bash.ts
│   ├── git.ts
│   ├── web-search.ts
│   ├── web-fetch.ts
│   └── index.ts
│
├── mcp/
│   ├── bridge.ts               # Converts MCP tools → AgentTool
│   ├── server-manager.ts       # Keep
│   └── config.ts               # Keep
│
├── teams/
│   ├── types.ts                # Keep: ITeamConfig, IAgentConfig, ITask, IIPCMessage
│   ├── manager.ts              # REWRITE: orchestrates pi-mono sessions instead of fork
│   ├── session-agent.ts        # NEW: wraps AgentSession as a controllable "team member"
│   ├── ipc-protocol.ts         # Keep: JSON-RPC 2.0 message definitions
│   ├── message-bus.ts          # Keep: routing logic
│   ├── task-store.ts           # Keep: file-based persistence
│   └── plan-approval.ts        # Keep
│
├── panes/
│   ├── layout-engine.ts        # KEEP UNCHANGED
│   ├── tmux-manager.ts         # KEEP UNCHANGED
│   ├── iterm2-manager.ts       # KEEP UNCHANGED
│   ├── ipc-hub.ts              # KEEP: Unix socket server
│   └── pane-process.ts         # KEEP: IPC client in agent processes
│
├── providers/
│   # ENTIRE DIRECTORY DELETED
│   # All provider logic lives in @pi/ai + extensions
│
├── auth/
│   # ENTIRE DIRECTORY DELETED
│   # Auth lives in @pi/coding-agent auth-storage
│
├── skills/
│   ├── types.ts                # Keep
│   ├── registry.ts             # Rewrite: wrap as pi-mono extension
│   ├── executor.ts             # Rewrite: use extension runner hooks
│   └── built-in/               # Keep individual skill definitions
│
├── extensions/
│   ├── aemeath-extension.ts    # NEW: Aemeath's own pi-mono extension (teams, skills, MCP bridge)
│   └── custom-providers/       # NEW: user-defined provider extensions (pi-mono pattern)
│
├── config/
│   ├── schema.ts               # NEW: Zod schema, merges old config + pi-mono config
│   ├── loader.ts               # NEW: loads global + project config, validates
│   └── defaults.ts             # NEW: default values
│
├── cli/
│   ├── cli.ts                  # REWRITE: new entry, uses pi-mono session instead of fork dance
│   ├── chat-runner.ts          # REWRITE: drives AgentSession, handles stream events
│   └── commands/               # Keep: individual command handlers
│
├── ui/
│   ├── App.tsx                 # REWRITE: subscribes to AgentSession events
│   └── ...                     # Keep components, hooks adapted
│
└── types/
    ├── message.ts              # REPLACED: use @pi/agent AgentMessage directly
    ├── model.ts                # REPLACED: use @pi/ai Model directly
    ├── tool.ts                 # REPLACED: use @pi/agent AgentTool directly
    ├── team.ts                 # Keep
    ├── config.ts               # Merged into config/schema.ts
    └── errors.ts               # Keep
```

---

## 3. Core Abstraction: Replacing the Provider System

### What gets deleted

`src/providers/registry.ts`, `src/providers/types.ts`, all adapters.
`src/auth/` entirely.
`src/core/model-router.ts`.

### What replaces it

**Model resolution** comes from `@pi/coding-agent`'s `ModelRegistry`:

```typescript
// src/core/model-registry.ts
import { ModelRegistry, createModelRegistry } from "@pi/coding-agent/core/model-registry"
import { AemeathConfig } from "../config/schema"

export async function createAemeathModelRegistry(config: AemeathConfig): Promise<ModelRegistry> {
  const registry = await createModelRegistry({
    configDir: config.configDir,  // ~/.aemeath/
    extraModels: config.extraModels,
  })
  return registry
}
```

**Role-based routing** (Aemeath-specific, pi-mono doesn't have this) stays but becomes a thin layer on top:

```typescript
// src/core/role-router.ts
import { Model } from "@pi/ai"
import { ModelRegistry } from "@pi/coding-agent/core/model-registry"
import { ModelRole, IRoleConfig } from "../config/schema"

export class RoleRouter {
  constructor(
    private registry: ModelRegistry,
    private roles: Record<ModelRole, IRoleConfig>
  ) {}

  async resolve(role: ModelRole, userOverride?: string): Promise<Model> {
    if (userOverride) {
      const m = await this.registry.findModel(userOverride)
      if (m) return m
    }
    const cfg = this.roles[role]
    for (const id of [cfg.primary, ...cfg.fallback]) {
      const m = await this.registry.findModel(id)
      if (m) return m
    }
    return this.registry.getDefault()
  }
}
```

**Auth** comes from `@pi/coding-agent`'s `auth-storage.ts` verbatim. It already handles:
- File locking to prevent race conditions
- OAuth auto-refresh with distributed locking
- Priority: runtime override → auth.json → OAuth → env vars
- Shell command expansion (`!command`)

We call it directly from our session bootstrap, zero reimplementation.

---

## 4. Tool System: Porting to AgentTool

### The Core Interface Change

Old interface (`IToolRegistration`):
```typescript
interface IToolRegistration {
  definition: IToolDefinition
  category: ToolCategory
  requiresApproval(context, args): boolean
  execute(args, context): Promise<IToolResult>
}
```

New interface (pi-mono `AgentTool`):
```typescript
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> {
  name: string
  description: string
  label: string                  // short human-readable label
  parameters: TParameters        // TypeBox schema (not IToolParameter[])
  prepareArguments?: (args: unknown) => Static<TParameters>
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>
  ) => Promise<AgentToolResult<TDetails>>
}
```

### Aemeath Extension of AgentTool

We add permission metadata that pi-mono doesn't have:

```typescript
// src/tools/types.ts
import { AgentTool } from "@pi/agent"
import { TSchema } from "@sinclair/typebox"

export interface AemeathTool<TParameters extends TSchema = TSchema, TDetails = any>
  extends AgentTool<TParameters, TDetails> {
  category: "file" | "search" | "shell" | "web" | "git" | "mcp"
  requiresApproval(permissionMode: PermissionMode, params: Static<TParameters>): boolean
}
```

The approval logic hooks into pi-mono's `beforeToolCall` hook in `AgentLoopConfig`:

```typescript
// src/tools/registry.ts
function buildBeforeToolCallHook(
  tools: AemeathTool[],
  permissionMode: PermissionMode,
  onApprovalNeeded: (toolName: string, params: unknown) => Promise<boolean>
) {
  return async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
    const tool = tools.find(t => t.name === ctx.toolCall.name)
    if (!tool) return undefined
    if (tool.requiresApproval(permissionMode, ctx.toolCall.arguments)) {
      const approved = await onApprovalNeeded(ctx.toolCall.name, ctx.toolCall.arguments)
      if (!approved) return { block: true, reason: "User denied approval" }
    }
    return undefined
  }
}
```

### Tool Migration: bash.ts example

Old:
```typescript
export const bashTool: IToolRegistration = {
  definition: { name: "bash", description: "...", parameters: [...] },
  category: "shell",
  requiresApproval: (ctx, args) => ctx.permissionMode !== "permissive",
  execute: async (args, ctx) => {
    const result = await execa(args.command, { shell: true, cwd: ctx.workingDirectory })
    return { toolCallId: "", name: "bash", content: result.stdout, isError: false }
  }
}
```

New:
```typescript
// src/tools/bash.ts
import { Type } from "@sinclair/typebox"
import { AemeathTool } from "./types"

const BashParams = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  description: Type.Optional(Type.String({ description: "What this command does" })),
  timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds" })),
})

export const bashTool: AemeathTool<typeof BashParams> = {
  name: "Bash",
  label: "bash",
  description: "Execute a shell command and return its output.",
  category: "shell",
  parameters: BashParams,

  requiresApproval(mode, params) {
    if (mode === "permissive") return false
    return isDangerous(params.command)
  },

  async execute(toolCallId, params, signal, onUpdate) {
    onUpdate?.({ type: "start", command: params.command })
    try {
      const result = await runBash(params.command, {
        signal,
        timeout: params.timeout ?? 120_000,
        onOutput: (chunk) => onUpdate?.({ type: "output", chunk }),
      })
      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        details: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      }
    } catch (e) {
      return {
        content: [{ type: "text", text: String(e) }],
        details: { error: true },
      }
    }
  },
}
```

All other tools (read, write, edit, glob, grep, git, web-search, web-fetch) follow the same pattern. The schema changes from `IToolParameter[]` to TypeBox, the execute signature changes, the rest is the same logic.

---

## 5. Session Architecture: Replacing chat-runner.ts

### The Old Way

```
cli.ts → chat-runner.ts → ProviderRegistry.stream() → manual loop → TUI
```

Manual loop: provider yields chunks, we collect tool calls, execute them, push results back, repeat.

### The New Way

```
cli.ts → AgentSession (pi-mono) → stream events → TUI
```

Pi-mono's `AgentSession` already does the loop. We just configure it and subscribe.

```typescript
// src/core/session.ts
import { Agent } from "@pi/agent"
import { AgentSession, createAgentSession } from "@pi/coding-agent/core/agent-session"
import { SessionManager } from "@pi/coding-agent/core/session-manager"
import { SettingsManager } from "@pi/coding-agent/core/settings-manager"
import { ModelRegistry } from "@pi/coding-agent/core/model-registry"
import { ExtensionRunner } from "@pi/coding-agent/core/extensions/runner"
import { buildAemeathTools } from "../tools/registry"
import { AemeathConfig } from "../config/schema"
import { RoleRouter } from "./role-router"
import { ModelRole } from "../config/schema"

export interface AemeathSessionOptions {
  config: AemeathConfig
  cwd: string
  role?: ModelRole
  modelOverride?: string
  permissionMode?: "strict" | "standard" | "permissive"
  onApprovalNeeded?: (toolName: string, params: unknown) => Promise<boolean>
}

export async function createAemeathSession(opts: AemeathSessionOptions): Promise<AgentSession> {
  const { config, cwd, role = "coding", permissionMode = "standard" } = opts

  const modelRegistry = await createAemeathModelRegistry(config)
  const roleRouter = new RoleRouter(modelRegistry, config.roles)
  const model = await roleRouter.resolve(role, opts.modelOverride)

  const tools = buildAemeathTools({
    cwd,
    permissionMode,
    onApprovalNeeded: opts.onApprovalNeeded ?? defaultApprovalPrompt,
  })

  const agent = new Agent({
    model,
    systemPrompt: buildSystemPrompt(config, cwd),
    tools,
  })

  // Extensions: aemeath-extension wires skills, MCP tools, team coordination
  const extensionRunner = new ExtensionRunner(agent)
  await extensionRunner.loadExtension(aemeathExtension(config))

  return createAgentSession({
    agent,
    sessionManager: new SessionManager({ dir: config.sessionsDir }),
    settingsManager: new SettingsManager({ dir: config.configDir }),
    cwd,
    modelRegistry,
    extensionRunnerRef: { current: extensionRunner },
  })
}
```

### Stream Event Consumption in TUI

The TUI subscribes to `AgentSessionEvent` instead of hand-rolling the stream loop:

```typescript
// src/ui/hooks/useSession.ts
import { AgentSession, AgentSessionEvent } from "@pi/coding-agent/core/agent-session"

export function useSession(session: AgentSession) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)

  useEffect(() => {
    const unsub = session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "turn_start":
          setIsStreaming(true)
          break
        case "turn_end":
          setIsStreaming(false)
          setMessages(session.agent.state.messages)
          break
        case "message_update":
          setMessages([...session.agent.state.messages])
          break
        case "tool_execution_start":
          // show tool activity in UI
          break
        case "compaction_start":
          // show compaction indicator
          break
      }
    })
    return () => unsub()
  }, [session])

  return { messages, isStreaming }
}
```

---

## 6. Agent Teams: Rewriting the Coordination Layer

### Current Problem

`agent-process.ts` forks a new process, re-bootstraps everything, communicates via IPC. This means:
- Each agent loads all dependencies fresh
- IPC is raw message passing, poorly typed
- Error handling is fragile

### New Architecture

Each "team member" is an `AgentSession` instance. The Team Manager creates sessions, assigns tasks, collects results. The IPC hub becomes a session coordinator, not a process fork manager.

**For local teams** (single machine, same process group):

```typescript
// src/teams/session-agent.ts
import { AgentSession, AgentSessionEvent } from "@pi/coding-agent/core/agent-session"
import { IAgentConfig, ITask, AgentStatus } from "./types"

export class SessionAgent {
  public readonly id: string
  public readonly config: IAgentConfig
  private session: AgentSession
  private status: AgentStatus = "idle"
  private unsubscribe?: () => void

  constructor(config: IAgentConfig, session: AgentSession) {
    this.id = config.agentId
    this.config = config
    this.session = session
  }

  async assignTask(task: ITask): Promise<void> {
    if (this.status !== "idle") throw new Error(`Agent ${this.id} is ${this.status}`)
    this.status = "active"

    const prompt = formatTaskPrompt(task)
    await this.session.sendPrompt(prompt, { streamingBehavior: "followUp" })
  }

  subscribe(handler: (event: AgentSessionEvent) => void): () => void {
    this.unsubscribe = this.session.subscribe(handler)
    return this.unsubscribe!
  }

  getStatus(): AgentStatus { return this.status }
  getMessages() { return this.session.agent.state.messages }
}
```

**For split-panel display** (panes), the `SessionAgent` wraps in a `PaneAgent` that additionally wires to the tmux/IPC infrastructure:

```typescript
// src/teams/pane-agent.ts
import { SessionAgent } from "./session-agent"
import { IPCHub } from "../panes/ipc-hub"
import { AgentSessionEvent } from "@pi/coding-agent/core/agent-session"

export class PaneAgent extends SessionAgent {
  constructor(config: IAgentConfig, session: AgentSession, private hub: IPCHub) {
    super(config, session)
    // Forward session events to IPC hub for pane display
    this.subscribe((event: AgentSessionEvent) => {
      this.forwardEventToPane(event)
    })
  }

  private forwardEventToPane(event: AgentSessionEvent) {
    if (event.type === "message_update" || event.type === "turn_end") {
      this.hub.broadcast({
        jsonrpc: "2.0",
        method: "agent.streamChunk",
        params: {
          agentId: this.id,
          chunk: extractDisplayChunk(event),
        }
      })
    }
  }
}
```

### Team Manager Rewrite

```typescript
// src/teams/manager.ts
export class TeamManager {
  private teams = new Map<string, Team>()

  async createTeam(name: string, config: ITeamConfig): Promise<Team> {
    const agents = await Promise.all(
      config.members.map(async (memberConfig) => {
        const session = await createAemeathSession({
          config: this.globalConfig,
          cwd: process.cwd(),
          role: memberConfig.role,
          modelOverride: memberConfig.model,
          permissionMode: this.globalConfig.permissions.mode,
        })
        return new SessionAgent(memberConfig, session)
      })
    )

    const bus = new MessageBus()
    const taskStore = new TaskStore(name)
    const team = new Team({ name, config, agents, bus, taskStore })

    this.teams.set(name, team)
    return team
  }

  // Split-panel variant: also creates panes
  async createTeamWithPanes(name: string, config: ITeamConfig): Promise<Team> {
    const hub = new IPCHub()
    await hub.start()

    const agents = await Promise.all(
      config.members.map(async (memberConfig) => {
        const session = await createAemeathSession({ ... })
        return new PaneAgent(memberConfig, session, hub)
      })
    )

    // Layout + tmux pane creation
    const layout = LayoutEngine.compute(agents.length, terminalSize())
    const tmux = new TmuxManager()
    await tmux.createSession(name, layout, agents.map(a => a.id))

    const team = new Team({ name, config, agents, hub, taskStore: new TaskStore(name) })
    this.teams.set(name, team)
    return team
  }
}
```

---

## 7. Subagent Protocol

Claude Code's subagent pattern: main agent calls `Task` tool → spawns subagent → subagent runs to completion → result comes back as tool result.

We implement this as an `AgentTool` that creates a child session:

```typescript
// src/tools/spawn-agent.ts — the "Task" tool
import { Type } from "@sinclair/typebox"
import { AemeathTool } from "./types"
import { createAemeathSession } from "../core/session"

const SpawnAgentParams = Type.Object({
  description: Type.String({ description: "Short description of what this subagent does" }),
  prompt: Type.String({ description: "Full task prompt for the subagent" }),
  model: Type.Optional(Type.String({ description: "Model to use for this subagent" })),
  tools: Type.Optional(Type.Array(Type.String(), { description: "Tool names to allow" })),
})

export const spawnAgentTool: AemeathTool<typeof SpawnAgentParams> = {
  name: "Task",
  label: "spawn-agent",
  description: "Launch a subagent to handle a complex task. The subagent runs to completion and returns its result.",
  category: "orchestration",
  parameters: SpawnAgentParams,

  requiresApproval: () => false,  // orchestrator approves, not user

  async execute(toolCallId, params, signal, onUpdate) {
    onUpdate?.({ type: "spawning", description: params.description })

    const session = await createAemeathSession({
      config: getGlobalConfig(),
      cwd: process.cwd(),
      modelOverride: params.model,
      // restrict tools if specified
    })

    // Run the subagent until it stops
    let finalResult = ""
    const unsub = session.subscribe((event) => {
      if (event.type === "turn_end") {
        const lastMsg = event.message
        finalResult = extractText(lastMsg)
        onUpdate?.({ type: "progress", text: finalResult.slice(0, 200) })
      }
    })

    await session.sendPrompt(params.prompt)
    // Wait for completion
    await waitForIdle(session, signal)
    unsub()

    return {
      content: [{ type: "text", text: finalResult }],
      details: { toolCallId, agentDescription: params.description },
    }
  },
}
```

The main agent gets this tool in its tool list. When it calls `Task(...)`, a child `AgentSession` runs, and the result comes back as a tool result message — exactly as Claude Code does it, but built on pi-mono sessions instead of process forks.

---

## 8. Extension System: Aemeath as a Pi-mono Extension

Pi-mono's extension system is where custom behavior hooks in. Aemeath's specific features (skills, MCP, team orchestration tools) become an extension:

```typescript
// src/extensions/aemeath-extension.ts
import { ExtensionAPI, ExtensionEvent } from "@pi/coding-agent/core/extensions/types"
import { AemeathConfig } from "../config/schema"
import { SkillRegistry } from "../skills/registry"
import { MCPToolBridge } from "../mcp/bridge"
import { spawnAgentTool } from "../tools/spawn-agent"
import { sendMessageTool } from "../tools/send-message"

export function aemeathExtension(config: AemeathConfig) {
  return async (pi: ExtensionAPI) => {
    // Register custom providers via pi-mono's provider system
    for (const [name, providerConfig] of Object.entries(config.customProviders ?? {})) {
      pi.registerProvider(name, providerConfig)
    }

    // Inject team orchestration tools (spawn-agent, send-message)
    pi.onSessionStart(async (ctx) => {
      if (config.teams?.enableOrchestratorTools) {
        ctx.agent.tools = [
          ...ctx.agent.tools,
          spawnAgentTool,
          sendMessageTool,
        ]
      }
    })

    // Skill system: activate/deactivate based on slash commands
    const skillRegistry = new SkillRegistry(config.skillsDir)
    await skillRegistry.load()

    pi.registerSlashCommand({
      name: "skill",
      description: "Activate or deactivate a skill",
      async execute(args, ctx) {
        const [action, skillName] = args.split(" ")
        if (action === "activate") {
          const skill = skillRegistry.get(skillName)
          if (!skill) return { error: `Unknown skill: ${skillName}` }
          // Inject skill system prompt and tool restrictions
          ctx.actions.sendSystemMessage(skill.systemPrompt)
          if (skill.allowedTools) {
            ctx.agent.tools = ctx.agent.tools.filter(t => skill.allowedTools!.includes(t.name))
          }
        }
      }
    })

    // MCP tool bridge: load MCP servers, register their tools as AgentTools
    const mcpBridge = new MCPToolBridge(config.mcp ?? {})
    await mcpBridge.connect()

    pi.onSessionStart(async (ctx) => {
      const mcpTools = await mcpBridge.buildAgentTools()
      ctx.agent.tools = [...ctx.agent.tools, ...mcpTools]
    })

    // Intercept tool calls for cost tracking and permission enforcement
    pi.onToolCall(async (event) => {
      // already handled by beforeToolCall hook in tool registry
      return { success: true }
    })
  }
}
```

### Custom Provider Registration (what users write)

Users drop files in `~/.aemeath/extensions/my-provider.ts`:

```typescript
// ~/.aemeath/extensions/my-provider.ts
export default function(pi) {
  pi.registerProvider("my-company-llm", {
    baseUrl: "https://api.mycompany.com/v1",
    apiKey: "MY_COMPANY_API_KEY",
    api: "openai-completions",
    models: [{
      id: "myco-large",
      name: "MyCompany Large",
      reasoning: false,
      input: ["text"],
      cost: { input: 2.0, output: 8.0, cacheRead: 0.2, cacheWrite: 2.0 },
      contextWindow: 128000,
      maxTokens: 8192,
    }],
  })
}
```

This is exactly pi-mono's custom provider pattern. Zero new infrastructure needed.

---

## 9. MCP Bridge: AgentTool Adapter

The existing `MCPToolBridge` logic is correct. It needs to output `AgentTool[]` instead of `IToolRegistration[]`:

```typescript
// src/mcp/bridge.ts
import { AgentTool, AgentToolResult } from "@pi/agent"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { Type, TSchema } from "@sinclair/typebox"

export class MCPToolBridge {
  private clients = new Map<string, Client>()

  async buildAgentTools(): Promise<AemeathTool[]> {
    const tools: AemeathTool[] = []

    for (const [serverName, client] of this.clients) {
      const { tools: mcpTools } = await client.listTools()

      for (const mcpTool of mcpTools) {
        tools.push(this.convertMCPTool(serverName, mcpTool, client))
      }
    }

    return tools
  }

  private convertMCPTool(serverName: string, mcpTool: any, client: Client): AemeathTool {
    const parameters = convertMCPSchema(mcpTool.inputSchema) // → TypeBox schema

    return {
      name: `mcp__${serverName}__${mcpTool.name}`,
      label: `${serverName}/${mcpTool.name}`,
      description: `[MCP:${serverName}] ${mcpTool.description}`,
      category: "mcp",
      parameters,

      requiresApproval: (mode) => mode === "strict",

      async execute(toolCallId, params, signal): Promise<AgentToolResult<any>> {
        try {
          const result = await client.callTool({
            name: mcpTool.name,
            arguments: params,
          })
          const text = result.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n")
          return {
            content: [{ type: "text", text }],
            details: { serverName, toolName: mcpTool.name, raw: result },
          }
        } catch (e) {
          return {
            content: [{ type: "text", text: `MCP error: ${e}` }],
            details: { error: true },
          }
        }
      },
    }
  }
}
```

---

## 10. Config Schema: Merged

The new config schema merges AemeathCLI's current config with what pi-mono expects:

```typescript
// src/config/schema.ts
import { z } from "zod"

export const PermissionModeSchema = z.enum(["strict", "standard", "permissive"])
export const ModelRoleSchema = z.enum(["planning", "coding", "review", "testing", "bugfix", "documentation"])
export const PaneBackendSchema = z.enum(["tmux", "iterm2", "ghostty", "terminal-app"])

export const AemeathConfigSchema = z.object({
  version: z.string().default("2.0.0"),
  configDir: z.string(),         // ~/.aemeath/
  sessionsDir: z.string(),       // ~/.aemeath/sessions/
  skillsDir: z.string(),         // ~/.aemeath/skills/
  extensionsDir: z.string(),     // ~/.aemeath/extensions/

  // Model + roles (Aemeath-specific, not in pi-mono)
  defaultRole: ModelRoleSchema.default("coding"),
  roles: z.record(ModelRoleSchema, z.object({
    primary: z.string(),
    fallback: z.array(z.string()).default([]),
  })).optional(),

  // Pi-mono passes this through to model-registry/auth-storage
  // We add no new auth config; pi-mono's auth.json format is used

  // Tools + permissions
  permissions: z.object({
    mode: PermissionModeSchema.default("standard"),
    allowedPaths: z.array(z.string()).default([]),
    blockedCommands: z.array(z.string()).default([]),
  }).default({}),

  // Split-panel
  splitPanel: z.object({
    enabled: z.boolean().default(true),
    backend: PaneBackendSchema.default("tmux"),
    defaultLayout: z.enum(["auto", "horizontal", "vertical", "grid", "hub-spoke"]).default("auto"),
    maxPanes: z.number().int().min(1).max(16).default(4),
  }).default({}),

  // Teams
  teams: z.object({
    enableOrchestratorTools: z.boolean().default(true),
    maxConcurrentAgents: z.number().default(4),
  }).default({}),

  // MCP servers (compatible with pi-mono's extension-based loading)
  mcp: z.object({
    servers: z.record(z.object({
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      url: z.string().optional(),
      env: z.record(z.string()).optional(),
    })).default({}),
  }).optional(),

  // Cost tracking
  cost: z.object({
    budgetWarning: z.number().default(1.0),
    budgetHardStop: z.number().default(5.0),
    trackPerSession: z.boolean().default(true),
  }).default({}),

  // Custom providers (loaded as extensions)
  customProviders: z.record(z.object({
    baseUrl: z.string(),
    apiKey: z.string().optional(),
    api: z.string(),
    models: z.array(z.any()),
    oauth: z.any().optional(),
  })).optional(),

  // Extra models beyond what providers register
  extraModels: z.array(z.any()).optional(),
})

export type AemeathConfig = z.infer<typeof AemeathConfigSchema>
export type ModelRole = z.infer<typeof ModelRoleSchema>
export type IRoleConfig = { primary: string; fallback: string[] }
```

---

## 11. CLI Entry Point Rewrite

```typescript
// src/cli/cli.ts
import { Command } from "commander"
import { createAemeathSession } from "../core/session"
import { loadConfig } from "../config/loader"
import { render } from "ink"
import { App } from "../ui/App"

async function main() {
  const config = await loadConfig()

  const program = new Command("aemeath")
    .version(VERSION)
    .description("Aemeath CLI — multi-agent coding assistant")

  program
    .command("chat", { isDefault: true })
    .description("Start interactive chat session")
    .option("-m, --model <model>", "Override model")
    .option("-r, --role <role>", "Agent role (planning|coding|review|...)")
    .option("--permission <mode>", "Permission mode (strict|standard|permissive)")
    .action(async (opts) => {
      const session = await createAemeathSession({
        config,
        cwd: process.cwd(),
        role: opts.role,
        modelOverride: opts.model,
        permissionMode: opts.permission,
        onApprovalNeeded: createTerminalApprovalPrompt(),
      })

      const { waitUntilExit } = render(<App session={session} config={config} />)
      await waitUntilExit()
    })

  // Agent mode: pi-mono RPC mode instead of our custom IPC dance
  // When spawned as a team member, use pi-mono's RPC protocol
  program
    .command("agent")
    .description("Run as team agent (internal use)")
    .option("--rpc", "Use RPC mode for team coordination")
    .option("--session-id <id>", "Session ID to resume")
    .option("--model <model>", "Model override")
    .option("--role <role>", "Agent role")
    .action(async (opts) => {
      const session = await createAemeathSession({
        config,
        cwd: process.cwd(),
        role: opts.role,
        modelOverride: opts.model,
        permissionMode: "standard",
      })

      if (opts.rpc) {
        // Pi-mono's RPC mode: session listens on stdin/stdout for JSON-RPC commands
        await runRpcMode(session)
      } else {
        // Legacy: IPC hub mode for pane display
        await runPaneMode(session, opts.sessionId)
      }
    })

  program
    .command("team <action>")
    .description("Manage agent teams")
    .action(async (action, opts) => {
      const { teamCommand } = await import("./commands/team")
      await teamCommand(action, opts, config)
    })

  // ... other commands unchanged

  await program.parseAsync()
}

main().catch(console.error)
```

---

## 12. Migration Plan

The refactor happens in phases. Each phase leaves the project in a working state.

### Phase 1: Foundation (1-2 weeks)

Add pi-mono as workspace packages or npm dependencies.

```json
// package.json
{
  "dependencies": {
    "@pi/ai": "workspace:../pi-mono-main/packages/ai",
    "@pi/agent": "workspace:../pi-mono-main/packages/agent",
    "@pi/coding-agent": "workspace:../pi-mono-main/packages/coding-agent"
  }
}
```

Write `src/core/session.ts` — the thin wrapper. Write `src/config/schema.ts` with merged schema.

Verify: `aemeath chat` works with a single session backed by pi-mono.

### Phase 2: Tools (3-4 days)

Port all tools to `AemeathTool` interface. Delete `src/tools/registry.ts` (old style), write the new one using `beforeToolCall` hook.

Verify: all tools work, approval flow works.

### Phase 3: Delete Old Provider/Auth Stack (2-3 days)

Delete `src/providers/`, `src/auth/`, `src/core/model-router.ts`, `src/core/context-manager.ts`.

Wire `RoleRouter` on top of pi-mono's `ModelRegistry`. Verify: model switching, role-based routing, OAuth login all work.

### Phase 4: Extension System (3-4 days)

Write `src/extensions/aemeath-extension.ts`. Move skills into extension hooks. Wire MCP bridge as extension-loaded tools. Write custom provider loading from `extensionsDir`.

Verify: skills activate/deactivate, MCP tools appear, custom providers register.

### Phase 5: Teams Rewrite (1 week)

Write `session-agent.ts` and `pane-agent.ts`. Rewrite `manager.ts` to use sessions instead of process forks. Wire `spawnAgentTool` for subagent delegation.

Keep `ipc-hub.ts`, `tmux-manager.ts`, `layout-engine.ts` unchanged — they still handle the display side.

Verify: team mode creates multiple sessions, split-panel works, task assignment works.

### Phase 6: TUI Update (3-4 days)

Rewrite `src/ui/App.tsx` to subscribe to `AgentSessionEvent` instead of hand-rolled stream loop. Remove `useStream` hook, replace with `useSession`.

Verify: streaming display, tool activity, compaction indicator, model switching all work in TUI.

---

## 13. What NOT to Port

These things from Claude Code we explicitly do not implement:

- **Claude-specific tool names** (TodoWrite, ExitPlanMode, etc.) — these are Claude Code's internal tools. We build our own equivalents with our own names.
- **CLAUDE.md system** — we have our own skill system; no need to duplicate.
- **Anthropic-specific auth flow** — pi-mono already handles Anthropic OAuth. We don't reinvent it.
- **Claude Code's specific prompt format** — we learn the _pattern_ (system prompt injection, compaction, context management) not copy the strings.

What we do port (as patterns, not code):
- Agent loop with `beforeToolCall`/`afterToolCall` hooks → pi-mono already has this, we use it
- Subagent delegation via tool call → `spawnAgentTool` above
- Context compaction → pi-mono has `compaction/` module, we configure it
- Slash command system → pi-mono has `slash-commands.ts`, we add ours
- Approval flow → `beforeToolCall` hook with user prompt

---

## 14. Data Flow: End-to-End

```
User types prompt
       │
       ▼
  App.tsx handleSubmit()
       │
       ▼
  session.sendPrompt(prompt)
       │
       ▼
  AgentSession (pi-mono)
  ├── buildContext(): systemPrompt + messages + tools
  ├── AgentLoopConfig.streamFn(): calls @pi/ai provider
  │         │
  │         ▼
  │   @pi/ai streaming protocol
  │   Events: text_delta, toolcall_start, toolcall_end, done
  │         │
  ▼         ▼
  AgentLoop processes tool calls:
  ├── beforeToolCall hook → AemeathTool.requiresApproval()
  │         → if needs approval → onApprovalNeeded() → UI prompt
  ├── tool.execute(toolCallId, params, signal, onUpdate)
  │         → real filesystem / bash / web operation
  └── afterToolCall hook → cost tracking, logging
       │
       ▼
  AgentSessionEvent stream → useSession() hook → React rerender
       │
       ▼
  User sees result in TUI

  [Team Mode path:]
  spawnAgentTool.execute()
       │
       ▼
  createAemeathSession() → child AgentSession
       │
       ▼
  child session runs to completion
       │
       ▼
  finalResult → AgentToolResult → parent session message history
```

---

## 15. Key Engineering Invariants

1. **No process forks for local agents.** `SessionAgent` wraps an `AgentSession`, runs in-process. Process isolation only when explicitly needed for sandboxing (future: Docker mode via pi-mono's mom pattern).

2. **All tool calls go through `beforeToolCall`.** No tool executes without passing through the approval hook. The hook is set at `AgentSession` creation time, not at tool definition time.

3. **Pi-mono's message types are canonical.** `AgentMessage`, `UserMessage`, `AssistantMessage`, `ToolResultMessage` — we don't define our own. Our `IAgentMessage` (inter-agent IPC) stays but is separate from the LLM message protocol.

4. **Extensions are the extension point.** New providers, new tool hooks, new slash commands — all go through `ExtensionAPI`. No ad-hoc patches to session internals.

5. **Split-panel display is decoupled from execution.** `SessionAgent` runs the logic. `PaneAgent` adds the display wiring. A team can run headlessly without panes.

6. **Auth is pi-mono's auth-storage.** `~/.aemeath/auth.json` follows pi-mono's format. OAuth providers are registered through the extension system. We add no auth logic.
