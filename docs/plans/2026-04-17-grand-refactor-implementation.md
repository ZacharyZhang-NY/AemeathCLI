# GRAND_REFACTOR Implementation Plan

> For Hermes: execute this by consolidating runtime around pi packages, not by copying reference source files.

Goal: Replace AemeathCLI's custom provider/auth/agent-loop plumbing with pi-based session infrastructure while preserving Aemeath-specific panes, teams, MCP, skills, and role routing.

Architecture: Introduce a new config/core/session/tooling layer that wraps @mariozechner/pi-coding-agent, @mariozechner/pi-agent-core, and @mariozechner/pi-ai. Keep Aemeath-specific UI/components and team/pane infrastructure where sane, but route execution through AgentSession and extension-registered tools.

Tech Stack: TypeScript, Ink, Commander, Zod, @sinclair/typebox, @mariozechner/pi-ai, @mariozechner/pi-agent-core, @mariozechner/pi-coding-agent.

---

## Task 1: Add pi dependencies and refactor scaffolding
Objective: Make the project capable of importing pi SDK packages and new config/core modules.
Files:
- Modify: package.json
- Create: src/config/defaults.ts
- Create: src/config/schema.ts
- Create: src/config/loader.ts

Verification:
- npm install succeeds
- TypeScript can resolve pi package imports

## Task 2: Create the new session/auth/model foundation
Objective: Replace custom routing bootstrap with pi-backed session creation.
Files:
- Create: src/core/auth.ts
- Create: src/core/model-registry.ts
- Create: src/core/role-router.ts
- Create: src/core/session.ts

Verification:
- A session can be created with AuthStorage, ModelRegistry, SessionManager, and custom config
- Role-based model resolution works without custom providers/auth modules

## Task 3: Port tool contracts to pi extension ToolDefinition
Objective: Build a new tool layer that uses pi built-ins where appropriate and custom Aemeath tools where needed.
Files:
- Create: src/tools/types.ts
- Rewrite: src/tools/registry.ts
- Rewrite: src/tools/bash.ts
- Rewrite: src/tools/git.ts
- Rewrite: src/tools/web-search.ts
- Rewrite: src/tools/web-fetch.ts
- Create: src/tools/spawn-agent.ts
- Update: src/tools/index.ts

Verification:
- Tool list builds for a session
- Approval gating is enforced before execution
- Custom tools return valid tool results

## Task 4: Rewrite MCP bridge and Aemeath extension
Objective: Register Aemeath-specific behavior through pi's extension system.
Files:
- Create: src/mcp/bridge.ts
- Create: src/extensions/aemeath-extension.ts
- Optionally adapt: src/skills/registry.ts, src/skills/executor.ts

Verification:
- Extension loads
- MCP tools can be registered as pi tools
- Session creation can include Aemeath extension behavior

## Task 5: Rewrite CLI and chat runtime around AgentSession
Objective: Replace direct provider streaming with session-driven runtime.
Files:
- Rewrite: src/cli/cli.ts
- Rewrite: src/cli/chat-runner.ts
- Rewrite: src/ui/App.tsx
- Create: src/ui/hooks/useSession.ts

Verification:
- Default interactive chat runs through AgentSession
- Streaming text, tool execution state, and final messages render in the TUI

## Task 6: Rewrite teams around in-process sessions
Objective: Replace child-process agent orchestration with session-backed team members.
Files:
- Create: src/teams/session-agent.ts
- Rewrite: src/teams/team-manager.ts
- Adapt: src/teams/message-bus.ts, src/teams/task-store.ts, src/teams/plan-approval.ts if needed

Verification:
- Team manager can create multiple session-backed agents
- Task assignment uses sessions, not provider loops
- Pane/panel integration still receives agent output

## Task 7: Update public exports and run full verification
Objective: Expose the new architecture cleanly and verify the repo.
Files:
- Rewrite: src/index.ts
- Any additional compatibility exports needed

Verification:
- npm run typecheck passes
- npm run lint passes
- npm run test passes if existing tests remain compatible
