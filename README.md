<p align="center">
  <br />
  <code>&nbsp;A E M E A T H&nbsp;</code>
  <br />
  <br />
  <strong>Next-generation multi-model CLI coding tool</strong>
  <br />
  Agent teams &middot; Split-panel coordination &middot; Role-based routing
  <br />
  <br />
  <a href="#installation"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="Node.js >= 20" /></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <a href="#supported-models"><img src="https://img.shields.io/badge/models-9-orange?style=flat-square" alt="9 Models" /></a>
  <a href="#providers"><img src="https://img.shields.io/badge/providers-5-purple?style=flat-square" alt="5 Providers" /></a>
</p>

<br />

```
  ╔══════════════════════════════════════════════╗
  ║           Welcome to AemeathCLI              ║
  ║    Multi-Model CLI Coding Tool v1.0.0        ║
  ╚══════════════════════════════════════════════╝
```

AemeathCLI orchestrates **multiple AI models** across **parallel agent teams** in your terminal. Route Claude for planning, GPT for coding, Gemini for reviews -- all in split-panel tmux panes with real-time streaming, cost tracking, and enterprise-grade security.

<br />

## Table of Contents

- [Why AemeathCLI](#why-aemeathcli)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Authentication](#authentication)
- [Usage](#usage)
- [Supported Models](#supported-models)
- [Role-Based Model Routing](#role-based-model-routing)
- [Agent Teams](#agent-teams)
- [Skills System](#skills-system)
- [MCP Integration](#mcp-integration)
- [Interactive Commands](#interactive-commands)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Security](#security)
- [Development](#development)
- [License](#license)

<br />

## Why AemeathCLI

Most AI coding tools lock you into a single model. AemeathCLI breaks that ceiling:

- **Multi-model orchestration** -- Use the right model for each task. Claude Opus for architecture, GPT-5.2 for implementation, Gemini 2.5 Pro for code review -- in one session.
- **Agent teams** -- Spawn parallel agents in tmux/iTerm2 split panes, each with their own model, role, and context. A leader coordinates, teammates execute.
- **Smart routing** -- Define role-based routing rules. When you switch to "review" mode, the system automatically picks the best model for reviewing code.
- **Cost-aware** -- Real-time token counting, per-model cost tracking, configurable budget warnings and hard stops. Know exactly what you're spending.
- **Skills & MCP** -- Extend functionality with YAML-defined skills and Model Context Protocol servers. Your tools, your workflow.
- **Enterprise-grade** -- OS keychain storage, AES-256-GCM encryption, HMAC-SHA256 IPC auth, sandboxed execution, structured logging, typed error hierarchy.

<br />

## Quick Start

```bash
# Install globally
npm install -g aemeathcli

# Authenticate with your providers
aemeathcli auth login claude
aemeathcli auth login codex
aemeathcli auth login gemini

# Start coding
aemeathcli "Refactor the authentication module to use JWT tokens"
```

That's it. AemeathCLI detects your project, picks the best model, and starts streaming.

<br />

## Installation

### Requirements

- **Node.js** >= 20.0.0
- **npm** >= 9 (or pnpm / yarn)
- **tmux** (optional, for split-panel mode)
- **iTerm2** (optional, macOS native pane support)

### Install

```bash
npm install -g aemeathcli
```

The CLI installs two commands: `aemeathcli` and the shorthand `ac`.

### Verify

```bash
aemeathcli --version
# 1.0.0
```

### First Run

```bash
aemeathcli config init
```

This launches an interactive setup wizard that walks you through provider authentication and initial configuration.

<br />

## Authentication

AemeathCLI supports four cloud providers with native OAuth PKCE login:

```bash
# Browser-based OAuth login (recommended)
aemeathcli auth login claude        # Anthropic
aemeathcli auth login codex         # OpenAI
aemeathcli auth login gemini        # Google
aemeathcli auth login kimi          # Moonshot

# Or set API keys directly
aemeathcli auth set-key claude sk-ant-api03-...
aemeathcli auth set-key codex sk-...
aemeathcli auth set-key gemini AIza...

# Check status
aemeathcli auth status
```

```
  claude   ● Logged in (user@example.com) — Pro plan
  codex    ● Logged in (user@example.com) — Plus plan
  gemini   ● Logged in (user@gmail.com)
  kimi     ○ Not logged in
```

Credentials are stored in your **OS keychain** (macOS Keychain, Windows Credential Vault, or Linux libsecret). An AES-256-GCM encrypted fallback is used when keychain is unavailable.

```bash
# Manage sessions
aemeathcli auth logout codex        # Single provider
aemeathcli auth logout --all        # All providers
aemeathcli auth switch claude       # Set default provider
```

<br />

## Usage

### Interactive Chat

```bash
# Start interactive session
aemeathcli 

# Start with a message
aemeathcli "Explain the architecture of this project"

# Specify model and role
aemeathcli chat --model gpt-5.2 --role coding "Add input validation to the API"

# With a custom system prompt
aemeathcli chat --system "You are a security auditor" "Review this codebase"
```

### Task-Specific Modes

```bash
# Planning mode — uses Claude Opus by default
aemeathcli plan "Design a caching layer for the API"

# Code review — analyzes specified files
aemeathcli review src/auth/ src/api/middleware.ts

# Test generation — uses Haiku/Flash for speed
aemeathcli test "Generate tests for the recent changes"
```

### Team Mode

```bash
# Spawn a 3-agent team in split tmux panes
aemeathcli team create "auth-feature" --agents 3 --model claude-sonnet-4-6

# List active teams
aemeathcli team list

# Clean up
aemeathcli team delete "auth-feature"
```

<br />

## Supported Models

AemeathCLI ships with 9 models across 5 providers:

| Model | Provider | Context | Output | Input $/M | Output $/M |
|:------|:---------|--------:|-------:|----------:|-----------:|
| **claude-opus-4-6** | Anthropic | 200K | 32K | $15.00 | $75.00 |
| **claude-sonnet-4-6** | Anthropic | 200K | 16K | $3.00 | $15.00 |
| **claude-haiku-4-5** | Anthropic | 200K | 8K | $0.80 | $4.00 |
| **gpt-5.2** | OpenAI | 256K | 32K | $2.50 | $10.00 |
| **gpt-5.2-mini** | OpenAI | 256K | 16K | $0.15 | $0.60 |
| **o3** | OpenAI | 256K | 100K | $10.00 | $40.00 |
| **gemini-2.5-pro** | Google | 2M | 64K | $1.25 | $10.00 |
| **gemini-2.5-flash** | Google | 2M | 64K | $0.15 | $0.60 |
| **kimi-k2.5** | Moonshot | 128K | 8K | $0.50 | $2.00 |

Local models via **Ollama** (Llama, Mistral, etc.) are also supported with a configurable base URL.

<br />

## Role-Based Model Routing

AemeathCLI automatically selects the best model for each task through a 4-step resolution pipeline:

```
User Override  →  Role Config  →  Fallback Chain  →  System Default
```

### Default Role Assignments

| Role | Primary Model | Fallback Chain |
|:-----|:--------------|:---------------|
| **Planning** | Claude Opus 4.6 | GPT-5.2 &rarr; Gemini 2.5 Pro |
| **Coding** | Claude Sonnet 4.6 | GPT-5.2 &rarr; Gemini 2.5 Flash |
| **Review** | Claude Opus 4.6 | Gemini 2.5 Pro |
| **Testing** | Claude Haiku 4.5 | Gemini 2.5 Flash |
| **Bugfix** | Claude Sonnet 4.6 | GPT-5.2 |
| **Documentation** | Gemini 2.5 Flash | Claude Haiku 4.5 |

Override at any time:

```bash
# Session-level override
aemeathcli chat --model gpt-5.2 --role planning

# Or interactively
/model gemini-2.5-pro
/role review
```

Customize routing in `~/.aemeathcli/config.json`:

```json
{
  "roles": {
    "coding": {
      "primary": "gpt-5.2",
      "fallback": ["claude-sonnet-4-6", "gemini-2.5-flash"]
    }
  }
}
```

<br />

## Agent Teams

Spawn parallel agents that work together in coordinated split-panel layouts.

### How It Works

1. **Create a team** -- A leader agent orchestrates, teammates execute
2. **Split panels** -- Each agent gets its own tmux/iTerm2 pane
3. **IPC coordination** -- JSON-RPC 2.0 over Unix domain sockets with HMAC-SHA256 auth
4. **Task management** -- Built-in task store with dependencies, statuses, and assignments

```bash
aemeathcli team create "refactor-api" --agents 4 --layout grid
```

### Auto-Layout

| Agents | Layout |
|:------:|:-------|
| 2 | Horizontal 50/50 split |
| 3 | Leader top, 2 teammates bottom |
| 4 | 2&times;2 grid |
| 5+ | Leader top, teammates in grid below |

### Cross-Model Teams

Each agent can run a different model and role:

```json
{
  "agents": [
    { "name": "architect", "model": "claude-opus-4-6", "role": "planning" },
    { "name": "coder-1", "model": "gpt-5.2", "role": "coding" },
    { "name": "coder-2", "model": "claude-sonnet-4-6", "role": "coding" },
    { "name": "reviewer", "model": "gemini-2.5-pro", "role": "review" }
  ]
}
```

When tmux is unavailable, AemeathCLI gracefully falls back to a tab-based split panel in the terminal UI.

<br />

## Skills System

Extend AemeathCLI with reusable, model-agnostic skill files.

### Built-in Skills

| Skill | Trigger | Description |
|:------|:--------|:------------|
| Code Review | `$review` | Structured code review with severity ratings |
| Commit | `$commit` | Conventional commit message generation |
| Plan | `$plan` | Architecture and implementation planning |
| Debug | `$debug` | Systematic debugging with hypothesis testing |
| Test | `$test` | Test generation with coverage analysis |
| Refactor | `$refactor` | Safe refactoring with before/after validation |

### Custom Skills

Create a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: Custom skill for my workflow
version: 1.0.0
triggers:
  - $my-skill
  - my-skill
allowed-tools:
  - read
  - write
  - bash
model-requirements:
  preferred-role: coding
  min-context: 100000
---

# My Custom Skill

Instructions for the AI when this skill is active...
```

**Skill resolution priority:** Project (`.aemeathcli/skills/`) > User (`~/.aemeathcli/skills/`) > Built-in

<br />

## MCP Integration

Connect external tools via the [Model Context Protocol](https://modelcontextprotocol.io):

```json
// ~/.aemeathcli/mcp.json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"],
      "env": {}
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    }
  }
}
```

Features:

- **stdio + Streamable HTTP** transport
- **Automatic tool discovery** -- MCP tools appear alongside built-in tools
- **Namespaced** -- `mcp__serverName__toolName` prevents conflicts
- **Rate-limited** -- Configurable per-server call limits
- **Health-checked** -- Auto-restart on consecutive failures
- **Hot-reload** -- File watching with live config updates

<br />

## Interactive Commands

During a chat session:

| Command | Description |
|:--------|:------------|
| `/help` | Show available commands |
| `/model [name]` | Switch model or show current |
| `/model list` | List all available models |
| `/role [name]` | Switch role (planning, coding, review, testing, bugfix) |
| `/cost` | Show session cost breakdown |
| `/clear` | Clear conversation history |
| `/compact` | Compress context to free token budget |
| `/quit` | Exit the session |

<br />

## Configuration

### File Locations

```
~/.aemeathcli/
  config.json          # Global configuration
  credentials.enc      # Encrypted credential fallback
  mcp.json             # MCP server definitions
  skills/              # User-level custom skills
  teams/               # Team configurations
  tasks/               # Task persistence
  db/aemeathcli.db     # SQLite database (WAL mode)
  logs/                # Structured logs (pino)

.aemeathcli/           # Project-level overrides
  config.json          # Project configuration (merges over global)
  skills/              # Project-specific skills
  mcp.json             # Project-specific MCP servers
  AGENTS.md            # Agent instructions
```

### Key Settings

```json
{
  "defaultModel": "claude-sonnet-4-6",
  "permissions": {
    "mode": "standard",
    "allowedPaths": ["./"],
    "blockedCommands": ["rm -rf /", "git push --force"]
  },
  "splitPanel": {
    "enabled": true,
    "backend": "tmux",
    "defaultLayout": "auto",
    "maxPanes": 6
  },
  "cost": {
    "budgetWarning": 5.00,
    "budgetHardStop": 20.00,
    "currency": "USD"
  }
}
```

### Permission Modes

| Mode | Behavior |
|:-----|:---------|
| **strict** | All operations require explicit approval |
| **standard** | Reads auto-approved; writes and shell require approval |
| **permissive** | All operations auto-approved (trusted environments only) |

```bash
aemeathcli --permission-mode strict "Delete all unused imports"
```

<br />

## Architecture

```
aemeathcli/
  src/
    cli/           Command-line interface (Commander.js)
    ui/            Terminal UI components (Ink 5 / React)
    core/          Model router, event bus, context manager, cost tracker
    providers/     AI provider adapters (Vercel AI SDK)
    tools/         Built-in tools (bash, read, write, edit, glob, grep, git, web-fetch)
    auth/          OAuth PKCE login, credential store, session management
    teams/         Agent process management, message bus, task store
    panes/         tmux/iTerm2 integration, IPC hub, layout engine
    skills/        Skill loader, registry, executor
    mcp/           MCP client, server manager, tool bridge
    storage/       SQLite store, config store, conversation persistence
    types/         TypeScript type definitions, error hierarchy
    utils/         Logger, sanitizer, path resolver, retry, token counter
```

**99 source files** &middot; **~14,000 lines of TypeScript** &middot; **Zero `any` types** &middot; **Strict mode + all strict flags**

### Technology Stack

| Layer | Technology |
|:------|:-----------|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.7+ (maximum strict mode) |
| CLI Framework | Commander.js 13 |
| Terminal UI | Ink 5 (React 18 for CLI) |
| AI Integration | Vercel AI SDK + provider adapters |
| Database | better-sqlite3 (WAL mode) |
| Validation | Zod |
| Logging | pino (structured, redacted) |
| Auth | keytar (OS keychain) + AES-256-GCM fallback |
| Build | tsup (ESM-only, sourcemaps, DTS) |
| Testing | Vitest |
| Linting | ESLint v9 + typescript-eslint (strict type-checked) |

<br />

## Security

AemeathCLI is built with defense-in-depth:

- **Credential storage** -- OS keychain primary (macOS Keychain, Windows Credential Vault, Linux libsecret). AES-256-GCM encrypted file fallback with scrypt key derivation (N=32768, r=8, p=1) and per-file random salt.
- **IPC authentication** -- HMAC-SHA256 message signing for all inter-agent communication over Unix domain sockets. Socket permissions set to `0o700`.
- **Shell sandboxing** -- Dangerous command blocklist, sensitive environment variable filtering, configurable permission modes with per-operation approval.
- **Path traversal protection** -- All file operations validate resolved paths against the project root boundary.
- **SSRF protection** -- Web fetch blocks private IP ranges (RFC 1918, loopback, link-local, cloud metadata).
- **Secret redaction** -- pino structured logging with 15+ credential field paths redacted. Regex-based secret scrubbing for API keys in command output.
- **File permissions** -- All sensitive files written with `0o600`, directories with `0o700`.
- **Typed error hierarchy** -- 14 error classes with codes, user messages, diagnostic details, and recovery suggestions. No untyped `catch(e)` anywhere.

<br />

## Development

### Setup

```bash
git clone https://github.com/AemeathCLI/AemeathCLI.git
cd AemeathCLI
npm install
```

### Scripts

```bash
npm run build          # Build with tsup
npm run dev            # Watch mode
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint (strict type-checked)
npm run format         # Prettier
npm run test           # Vitest
npm run test:coverage  # With coverage report
```

### Project Conventions

- **Interfaces** use `I` prefix: `IModelInfo`, `IChatMessage`, `IToolResult`
- **Error classes** extend `AemeathError` with structured error codes
- **Type imports** use `import type { ... }` consistently
- **No `any`** -- enforced by ESLint `no-explicit-any` + `no-unsafe-*` rules
- **All `catch` blocks** use `catch (error: unknown)` or bare `catch {}`
- **Barrel exports** via `index.ts` in each module

<br />

## License

MIT

<br />

---

<p align="center">
  Built with Claude, GPT, and Gemini — orchestrated by AemeathCLI itself.
</p>
