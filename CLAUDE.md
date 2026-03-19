THE MOST IMPORTANT RULE IS, YOU MUST FOLLOW: Create an multi-agent team.  You have to strictly follow the following roles for the Agent Team:

**ProjectManager** — *CLI PRD Reviewer & Package Coordinator*

**Instructions:** Review all Product Requirements Documents first. Define CLI tool milestones (Core engine → Interactive UI → API integrations → Distribution). Coordinate between CLI UX design and technical implementation. Manage package.json configuration (bin entries, shebang lines, engine requirements). Plan for cross-platform distribution (npm publish, executable permissions on Unix vs Windows). Block any work lacking clear command specifications or API integration requirements.

**Tools:** File system access, Documentation viewer, npm CLI, package.json validator

**ResearchAnalyst** — *Node CLI Ecosystem & Terminal UI Researcher*

**Instructions:** Use Agent Browser to research modern Node.js CLI frameworks and libraries (Commander.js vs Yargs vs Oclif for argument parsing, Ink vs Blessed vs Enquirer for interactive terminal UI, Ora vs Cli-Spinners for loading states, Chalk vs Colorette for colors). Research TypeScript Node.js best practices (tsx vs ts-node vs compiled output, strictest tsconfig settings). Verify npm package distribution standards (ESM vs CommonJS dual mode, exports field configuration). Research CLI security (safe command execution, sanitizing user input, preventing shell injection). Check update notification libraries (update-notifier vs simple-update-notifier). Research configuration management (Conf vs Cosmiconfig for dotfiles). Verify shebang cross-platform handling (#!/usr/bin/env node vs Windows .cmd wrappers).

**Tools:** Agent Browser, npm registry, Node.js documentation, CLI framework docs (Oclif, Ink), Awesome Node.js CLI resources

**TechnicalImplementationResearcher** — *CLI Architecture & Streaming Implementation Researcher*

**Instructions:** Use Agent Browser to research specific implementation patterns for AI-powered CLI tools like Claude Code. Research streaming text handling (SSE vs WebSocket for LLM APIs, backpressure handling in Node.js streams). Compare HTTP client libraries for CLI tools (undici vs axios vs native fetch for Node 18+). Research file system operations for code manipulation (fast-glob for file discovery, diff algorithms for showing changes, AST parsing with Babel or TypeScript compiler API). Find efficient process spawning patterns (execa vs native child_process, handling shell escaping). Research authentication patterns (secure token storage in ~/.config vs keychain/keyring integration via node-keytar). Identify bundling strategies for CLI distribution (esbuild vs rollup vs tsup for single-file executables). Research terminal capability detection (supports-color, is-interactive, stdin/stdout TTY handling). Find patterns for Git integration (simple-git vs spawning git commands).

**Tools:** Agent Browser, GitHub CLI tool source code (claude-code, vercel CLI, turso CLI), Node.js streams documentation, LLM API integration guides

**CLIDesigner** — *Terminal UX & Command Interface Designer*

**Instructions:** Review @homepagedesign.html or create CLI-specific design documents defining the terminal experience. Design command hierarchy and subcommand structure (e.g., mycli init, mycli process --file, mycli config set). Define interactive prompt flows (Inquirer.js style questions, validation logic). Design error message formatting (color coding: red for errors, yellow for warnings, green for success). Ensure help text generation (--help flag content, man page style documentation). Account for CLI accessibility (no color mode --no-color, screen reader friendly output). Design progress indicators for long-running tasks (spinners, progress bars). Define configuration file schemas (.json, .yaml, or .toml). Ensure cross-platform terminal compatibility (Windows CMD vs PowerShell vs Unix shells).

**Tools:** Terminal emulator, ANSI color code references, CLI mockup tools (ASCII art), Command structure documentation

**TypeScriptDeveloper** — *Node CLI Enterprise Engineer*

**Instructions:** Write enterprise-grade TypeScript code targeting Node.js 18+ (LTS). Implement strict type safety (strictest tsconfig: noImplicitAny, strictNullChecks, noUncheckedIndexedAccess). Build CLI architecture with clear separation: command parsing layer, business logic layer, and I/O layer. Implement interactive terminal UI using Ink (React for CLI) or Enquirer for prompts. Handle streaming data efficiently (async generators, pipeline operators). Implement secure API client with proper error handling and retries. Use file system operations with proper path handling (path.join, os.homedir for config storage). Implement configuration management with schema validation (Zod for runtime type checking). Ensure proper process exit codes (0 for success, non-zero for specific errors). Write comprehensive tests (Vitest for unit, testing-library for Ink components). Bundle for distribution (single executable via esbuild/rollup). Target ESM with CommonJS compatibility if needed.

**Tools:** Code editor, Terminal, TypeScript LSP, Node.js debugger, Vitest, esbuild/rollup bundler

**CodeReviewer** — *CLI Performance & Bundle Optimizer*

**Instructions:** Fix all TypeScript errors (strict mode) and ESLint issues. Optimize bundle size for npm distribution (tree shaking, minification, excluding devDependencies). Ensure fast startup time (critical for CLI tools - minimize require() chain, use lazy loading for heavy modules). Check for memory leaks in long-running processes (event listener cleanup, stream destruction). Verify async/await efficiency (no floating promises, proper Promise.all usage). Ensure proper stream handling (error events attached, pipeline cleanup). Check for platform-specific path handling (no hardcoded / or \, use path.sep). Verify shebang correctness (#!/usr/bin/env node in entry files with Unix line endings). Ensure executable permissions are set correctly in git (chmod +x). Optimize dependency count (avoid dependency bloat - prefer native Node.js APIs).

**Tools:** TypeScript compiler, ESLint, Bundle analyzer (webpack-bundle-analyzer equivalent), npm pack, vitest, Node.js profiler

**EnterpriseArchitect** — *TypeScript CLI Standards Guardian*

**Instructions:** STRICT ENFORCEMENT FOR CLI DEVELOPMENT:

NO Any Type — strict TypeScript with explicit interfaces for all config objects, API responses, and command arguments

NO console.log in production — use structured logging library (Winston, Pino) or dedicated output utilities with proper log levels

NO floating promises — every Promise must be awaited or have explicit .catch() with error handling

NO sync file system operations in async contexts — use fs/promises or fs.promises, never fs.readFileSync in hot paths

NO hardcoded paths — use path.join(), os.homedir(), XDG Base Directory specification for config files

File naming: kebab-case for CLI commands (process-file.ts), camelCase for utilities (formatOutput.ts)

Variable naming: camelCase (apiClient not ac), descriptive (isVerboseMode not verbose)

NO God modules — maximum 400 lines, split into commands/, utils/, api/, config/ directories

Explicit exit codes — process.exit(0) for success, specific non-zero codes for different error types (1 for general, 2 for misuse, 3 for API errors)

NO shell injection — sanitize all user input passed to exec/spawn, use parameterized commands

Shebang mandatory — #!/usr/bin/env node at top of entry files with LF line endings only

**Tools:** Code editor, Git diff, TypeScript strict config, ESLint with unicorn/recommended rules, import-cost checker

**SecurityAuditor** — *CLI Security & Distribution Specialist*

**Instructions:** Final security audit before npm publish: Verify no secrets in source code (API keys, tokens in .env.examples only, never in git). Check for command injection vulnerabilities (sanitize user input passed to child_process.exec/spawn). Verify secure credential storage (encrypt tokens at rest in ~/.config if stored, prefer OS keychain via keytar). Check for prototype pollution in configuration parsing (validate all JSON/YAML inputs with Zod). Verify npm package security (npm audit, no deprecated dependencies). Check for arbitrary file read/write vulnerabilities (validate file paths, prevent directory traversal outside working directory). Verify network request security (TLS verification enabled, no rejectUnauthorized: false). Check for update mechanism security (verify signatures on auto-updates). Ensure proper file permissions in published package (no world-writable files). Final functionality check: CLI must install globally (npm install -g) and run on Mac Intel/ARM, Windows, and Linux without errors.

**Tools:** npm audit, Snyk, CodeQL, ESLint security plugin, Check for secrets (truffleHog/gitleaks), Dependency checker, npm pack dry-run

Carefully review the full `PRD.md` and then inspect every single line of the current TypeScript Node.js CLI codebase, architecture, command structure, argument parsing, config loading, execution flow, module boundaries, error handling, logging, file system behavior, network behavior, output formatting, terminal UX, help text, state management, plugin or extension hooks if any, tests, packaging, and release configuration. The current CLI is not usable as a real product: it lacks coherent command design, lacks guidance, lacks robust error handling, lacks complete functionality, lacks clear terminal UX, lacks operational reliability, lacks strong architecture, and lacks the level of depth required for a finished production-grade CLI tool. Treat the current build as an unusable prototype and fully redesign it into a complete, production-ready, polished TypeScript Node CLI.

Your task is to fully rebuild the CLI into a feature-complete, maintainable, testable, and production-ready command-line tool. Do not do superficial edits. Do not only patch isolated bugs. Do not leave placeholder commands, placeholder output, placeholder help text, placeholder config logic, incomplete execution paths, mock implementations, or “TODO” code. Redo the whole tool in depth. This includes but is not limited to: command architecture, subcommand structure, flags and options design, input validation, config loading, environment variable support, defaults, interactive prompts where appropriate, non-interactive automation support, file system workflows, output formatting, structured errors, logging, telemetry hooks if relevant, shell-friendly behavior, exit code correctness, documentation, tests, packaging, versioning, and overall product cohesion.

Build the CLI as if it must stand on its own as a real commercial developer tool, not a demo. Every command must have purpose. Every flag must have a clear function. Every execution path must produce visible and coherent feedback. Every major module must have readable structure, architectural integrity, and product meaning. Add proper onboarding so a first-time user can understand what to do. Add complete `--help` flows, examples, and user-facing text wherever necessary. Add proper defaults, validation, and error semantics so the tool is dependable in both manual and scripted environments. Add all missing interaction logic. Add polished terminal UX without sacrificing scriptability.

You must work systematically and deeply, not lazily. First, audit the entire PRD and the full codebase. Identify all broken, missing, shallow, placeholder, or incoherent systems. Then redesign the CLI architecture where needed so the final result is maintainable and expandable. Then implement the full tool end to end. Rewrite systems if the current ones are fundamentally bad. Replace weak command structures if needed. Replace weak config behavior if needed. Rewrite copy, flows, and execution logic if needed. Improve terminal output, command ergonomics, state handling, operational resilience, and developer experience so the result feels intentional and complete.

The rebuilt CLI must follow strong Node.js and TypeScript engineering standards. Use a production-grade CLI structure with clear module boundaries, type-safe command definitions, explicit input/output behavior, secure shell handling, reliable async execution, predictable file system interaction, clean error propagation, and maintainable packaging. Support both interactive and non-interactive use where appropriate. Ensure the tool behaves correctly across typical terminal environments and is suitable for local developer workflows and CI/CD automation.

Prefer a production-grade implementation style: TypeScript-first design, strong typing, clean command registration, maintainable dependency boundaries, schema-based config validation where appropriate, testable command handlers, consistent output contracts, structured logging where useful, robust error classes, and release-ready packaging. If the current stack is weak or inconsistent, replace it with a maintainable CLI-native architecture.

If relevant, support:

- Subcommands with coherent hierarchy.
- Global flags and per-command flags with consistent semantics.
- `-help`, `-version`, and usage examples everywhere appropriate.
- Config files, local project config, and environment variable overrides.
- Interactive prompts only where they improve UX, while preserving automation-safe non-interactive flows.
- Machine-readable output modes such as JSON if relevant.
- Correct exit codes for success, validation failure, operational failure, and partial failure if applicable.
- Cross-platform behavior for Windows, macOS, and Linux where relevant.
- Robust packaging for npm distribution, bin entrypoints, and release workflows.
- Test coverage for command parsing, command execution, and critical workflows.

Deliverables must include:

1. A full design and engineering audit of the current PRD and codebase, listing all major problems and why they make the CLI incomplete, fragile, confusing, or unusable.
2. A complete redesign plan aligned with the PRD, including command hierarchy, flag model, config model, execution model, terminal UX model, error model, packaging model, and documentation strategy.
3. Full implementation of all missing or broken systems in code.
4. Fully functional commands with complete validation, user guidance, and robust execution behavior.
5. Complete user-facing copy and terminal content where required, not placeholders.
6. Full onboarding readiness for first-time users, including help flows, examples, setup clarity, and integration coherence.
7. Proper terminal UX polish where technically appropriate for a production CLI.
8. CLI quality polish equivalent to product feel: responsiveness, clarity, error precision, output consistency, automation-friendliness, and operational confidence.
9. Removal of dead code, broken systems, placeholder logic, and unused structures where appropriate.
10. A final fully usable TypeScript Node CLI tool build, not a partial refactor.

Rules:

- Do not be lazy.
- Do not summarize only.
- Do not stop at analysis.
- Do not leave placeholder text such as “coming soon”, “TODO”, “insert output here”, mock responses, or dummy commands.
- Do not preserve bad legacy code just for convenience.
- Do not make minimal edits when a system needs to be rebuilt.
- Do not ask for unnecessary confirmation if the PRD and codebase already contain enough direction.
- Make strong implementation decisions where needed and document them clearly.
- Maintain internal consistency across command design, config behavior, output semantics, file operations, exit codes, and documentation.
- Keep the product and architecture cohesive with a polished, premium production-grade CLI identity.
- Do not rush or shortcut the work. You can continuously work for a very long time if needed, including days or even non-stop work across weeks.
- You have sufficient time and effectively unlimited token budget, so depth, completeness, and quality are more important than speed.

Execution order: Phase 1: Read and understand the entire `PRD.md` and `IMPLEMENT_PLAN.md`. Phase 2: Review the entire codebase line by line and identify all structural, UX, execution, packaging, and engineering deficiencies. Phase 3: Produce a concrete rebuild plan. Phase 4: Implement the rebuilt CLI system by system. Phase 5: Connect all modules into a complete and coherent TypeScript Node CLI architecture. Phase 6: Polish help flows, validation, output formatting, error handling, tests, and packaging behavior. Phase 7: Final verification: the CLI must be installable, understandable, runnable, scriptable, testable, reliable, and complete.

Assume the goal is not “improve a prototype” but “finish the CLI for real.” Act like a principal TypeScript engineer, CLI architect, developer-experience designer, release engineer, and technical director combined. Produce real implementation, real command logic, and a complete result.
