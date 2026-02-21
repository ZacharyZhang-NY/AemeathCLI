# AemeathCLI Summarizer

Date: 2026-02-21
Team Role: RepoSummarizer
Scope: source analysis + docs/runtime consistency check

## Project Overview
AemeathCLI is a terminal-native AI orchestration stack with two major execution paths:

- Command-mode path: Commander entrypoint -> command handlers (`chat`, `plan`, `review`, `test`, `config`, `auth`).
- Interactive path: Ink TUI in `App.tsx` -> model/provider resolution -> provider registry -> streaming model loop.
- Team path (partially integrated): AI-designed team manifests are generated in UI and executed through tmux/iTerm split backends or an in-process agent pool.

The reviewed surface includes CLI command wiring, auth provider logic, provider adapters/registry, team orchestration, pane management, type models, and UI components/hooks.

## Architecture Summary (with component diagram in ASCII)

```text
+-----------------------------+
+| aemeathcli CLI invocation   |
+|  (stdin / aemeathcli ... )  |
++--------------+--------------+
+               |
+               v
+ +---------------------------+            +--------------------+
+ | src/cli/cli.ts             |----------->| src/cli/commands    |
+ | program + subcommands      |            | auth.ts            |
+ +------------+---------------+            | team.ts (unused)    |
+              |                            +--------------------+
+              v
+ +---------------------------+                      
+ | src/ui/App.tsx             |
+ | Input parser / slash UI     |
+ +------------+--------------+
+              |
+              v
+   +----------+-----------------------------+
+   | Provider flow resolution             |
+   | useModel / ModelResolver / getModel...|
+   +----------+-----------------------------+
+              |
+              v
+   +--------------------+    +----------------------+
+   | src/providers      |    | src/types/model.ts    |
+   | registry/adapters   |--->| model/provider metadata|
+   +----------+---------+    +-----------+----------+
+              |                          |
+              | model + provider         |
+              v                          |
+       +--------------+                   |
+       | src/teams/*   |<------------------+
+       | TeamManager   |
+       | AgentProcess  |
+       +------+--------+
+              |
+              +-------------------------+
+              |                         |
+       +------+--------+         +------+---------+
+       | src/panes/iterm2 |     | src/panes/tmux |
+       | scripts, launch   |     | split sessions |
+       +-----------------+     +----------------+
+
+                 +------------------------------+
+                 | UI layer: hooks/components   |
+                 | useStream/usePanel/useCost   |
+                 +------------------------------+
+```

## Current Problems & Issues (ranked by severity)

1. P1 — Team command is implemented but unreachable from CLI entrypoint.
- Evidence: `src/cli/commands/team.ts` exposes `createTeamCommand()` and subcommands (`create/start/stop/list/delete`) (`src/cli/commands/team.ts:89`, `:90`, `:122`, `:146`, `:197`, `:219`, `:246`).
- Evidence: `src/cli/cli.ts` registers only chat/plan/review/test/config/auth, with no `createTeamCommand()` registration (`src/cli/cli.ts:344-349`).
- Impact: command-mode users cannot reach team lifecycle commands despite documented intent and existing implementation.

2. P1 — Provider naming/alias is fragmented and non-canonical across layers.
- Evidence: Auth command validation is fixed to `VALID_PROVIDERS = ["claude", "codex", "gemini", "kimi"]` (`src/cli/commands/auth.ts:9`).
- Evidence: `set-key` separately maps `openai` and `google` to canonical provider keys (`src/cli/commands/auth.ts:143`).
- Evidence: UI help/auth handling lists `codex` and duplicates provider arrays (`src/ui/App.tsx:1612`, `:1638`, `:1646`).
- Evidence: type-level provider names are canonical (`anthropic|openai|google|kimi|ollama`) (`src/types/model.ts:7`).
- Impact: support flows are surprising (`set-key openai` works, `switch openai` fails), and validation behavior differs by command path.

3. P1 — Team execution state is single-global in UI, not multi-session safe.
- Evidence: module-scope mutable singletons `activeTeamManager`, `activeTeamName`, `activeTmuxCleanup` (`src/ui/App.tsx:790-793`).
- Evidence: `/team stop` only consumes singular globals (`src/ui/App.tsx:1491-1503`, `:1532`).
- Impact: multiple concurrent team sessions overwrite each other; stop/dispose can target wrong team metadata and leak others.

4. P2 — Team startup success is partial but treated as success.
- Evidence: agent starts are launched with `Promise.allSettled` and no aggregate failure branch for any individual rejection (`src/teams/team-manager.ts:175`, `:192`).
- Impact: one or more agents can fail to start while UI/CLI still reports success, creating inconsistent team state and silent capability loss.

5. P2 — Team inventory is derived from disk list and can report non-active/stale teams.
- Evidence: `TeamManager.listTeams()` returns `this.storage.listTeams()` directly, while active state is tracked in-memory (`src/teams/team-manager.ts:222`, `:324-329`).
- Impact: terminated/crashed team entries can remain exposed in `aemeathcli team list` without guaranteed process liveness.

6. P2 — Docs/runtime contract diverges on provider/model surface and command surfaces.
- Evidence: README claims “models-9” and a 9-row model table (`README.md:13`, `:218-230`) plus command examples using only gpt-5.2 style names.
- Evidence: runtime model catalog includes additional IDs not in table (e.g., `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `kimi-for-coding`, `claude-opus-4-6-1m`, `gpt-5.2-codex`, etc.) (`src/types/model.ts:239-387`, `:411-427`).
- Evidence: Interactive command table omits `/team` commands while slash parser/autocomplete offer them (`README.md:437-447`; `src/ui/autocomplete-data.ts:25-27`; `src/ui/App.tsx:1532`).
- Impact: users and operators cannot trust docs for supported behavior.

7. P3 — Recovery observability for auth/provider/model fallback is coarse.
- Evidence: model/auth failures in App fall back and often surface generic terminal messages with limited per-provider diagnosis (`src/ui/App.tsx:178`, `:183`, `:216`, `:890-899`, `:936`).
- Impact: operational triage is slower during provider outages and token routing failures.

8. P4 — TODO/FIXME debt is mostly absent from src.
- Evidence: repository-wide `rg --line-number --ignore-case "TODO|FIXME" src` returned no matches.
- Impact: no explicit deferred-work markers; potential debt is hidden in behavior-level mismatches instead.

## Modified Files Analysis (what changed and why it matters)

- `summarize.md` (new/updated): Added consolidated findings, severity-ranked defects, architecture diagram, missing implementation list, and recommendations for handoff.
- `.aemeathcli/team-board/RepoSummarizer.md` (new/updated): Provided same high-signal findings for cross-agent integration and reviewability.
- No source code files were modified in this summarization pass.
- Why this matters: the requested role is documentation-only; no runtime behavior changed, so findings represent current-ground truth only.

## Missing Implementations

- Register team command in CLI entrypoint (`createTeamCommand`) so command-mode access works.
- Single authoritative provider alias map shared by `auth.ts`, UI slash handlers, registry, and README generation.
- Active team registry in UI for concurrent team sessions (map keyed by session/team name), replacing global singleton state.
- Team lifecycle error contract in `TeamManager.startAgents` with explicit failure aggregation and rollback/cleanup strategy.
- Team list contract split by source (configured vs live process state) to avoid stale active entries.
- Model surface audit script/docs generation to reconcile README tables with `SUPPORTED_MODELS` and adapters.

## Recommendations

1. Add `createTeamCommand` registration in `src/cli/cli.ts` near other command registrations.
2. Introduce `src/types/provider-contract.ts` (or equivalent) to define canonical provider IDs and aliases, then consume it in:
   - `src/cli/commands/auth.ts`
   - `src/ui/App.tsx`
   - `src/providers/registry.ts`
   - docs generation source or README checks.
3. Replace `activeTeamManager/activeTeamName/activeTmuxCleanup` with a per-session state map in App and route `/team stop` to explicit team context.
4. Change `TeamManager.startAgents` from silent `Promise.allSettled` to structured result aggregation and explicit non-zero exit reporting.
5. Split team inventory into `listConfiguredTeams` + `listActiveRuntimeTeams` and expose status with process heartbeat/check state.
6. Add regression checks for
   - `aemeathcli team create/list/start/stop` command discoverability and execution path,
   - auth alias behavior (`openai`/`google` in set-key/switch/status paths),
   - `/team` slash command visibility in interactive help/docs.
