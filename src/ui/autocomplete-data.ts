/**
 * Autocomplete data definitions for InputBar triggers
 * Shared by InputBar autocomplete popup and /help command
 */

// ── Slash Commands ──────────────────────────────────────────────────────────

export interface IAutocompleteItem {
  readonly label: string;
  readonly description: string;
}

export interface ISlashCommand {
  readonly command: string;
  readonly description: string;
}

export const SLASH_COMMANDS: readonly ISlashCommand[] = [
  { command: "/help", description: "Show available commands" },
  { command: "/model", description: "Select a model with provider-specific thinking options" },
  { command: "/role", description: "Switch role (planning, coding, review, testing, bugfix)" },
  { command: "/cost", description: "Show session cost breakdown" },
  { command: "/clear", description: "Clear conversation" },
  { command: "/compact", description: "Compress context" },
  { command: "/team list", description: "List active teams" },
  { command: "/team stop", description: "Deactivate team and return to single-pane" },
  { command: "/mcp list", description: "List connected MCP servers" },
  { command: "/mcp add", description: "Add an MCP server" },
  { command: "/skill list", description: "List available skills" },
  { command: "/panel", description: "Change split-panel layout" },
  { command: "/auth login", description: "Log in to a provider (claude, codex, gemini, kimi)" },
  { command: "/auth status", description: "Show login status for all providers" },
  { command: "/auth logout", description: "Log out of a provider" },
  { command: "/config get", description: "Get a configuration value" },
  { command: "/config set", description: "Set a configuration value" },
  { command: "/quit", description: "Exit" },
  { command: "/exit", description: "Exit" },
];

// ── Context References (@) ──────────────────────────────────────────────────

export const CONTEXT_REFS: readonly IAutocompleteItem[] = [
  { label: "@file", description: "Reference a file in the project" },
  { label: "@codebase", description: "Reference the entire codebase" },
  { label: "@anthropic", description: "Anthropic/Claude provider context" },
  { label: "@openai", description: "OpenAI/Codex provider context" },
  { label: "@google", description: "Google/Gemini provider context" },
  { label: "@kimi", description: "Kimi/Moonshot provider context" },
  { label: "@web", description: "Web search context" },
  { label: "@git", description: "Git repository context" },
  { label: "@docs", description: "Project documentation context" },
  { label: "@errors", description: "Recent error context" },
];

// ── Code References (`) ─────────────────────────────────────────────────────

export const CODE_REFS: readonly IAutocompleteItem[] = [
  { label: "`src/", description: "Source directory" },
  { label: "`src/ui/", description: "UI components" },
  { label: "`src/auth/", description: "Authentication modules" },
  { label: "`src/providers/", description: "LLM provider adapters" },
  { label: "`src/teams/", description: "Team management" },
  { label: "`src/core/", description: "Core engine" },
  { label: "`src/tools/", description: "Tool implementations" },
  { label: "`src/types/", description: "Type definitions" },
  { label: "`src/storage/", description: "Storage layer" },
  { label: "`src/utils/", description: "Utility functions" },
];

// ── Skill Invocation ($) ────────────────────────────────────────────────────

export const SKILL_REFS: readonly IAutocompleteItem[] = [
  { label: "$review", description: "Comprehensive code review" },
  { label: "$commit", description: "Smart git commit with message generation" },
  { label: "$plan", description: "Create implementation plan from requirements" },
  { label: "$debug", description: "Systematic debugging workflow" },
  { label: "$test", description: "Generate tests for code" },
  { label: "$refactor", description: "Refactoring with safety checks" },
];

// ── Trigger Detection ───────────────────────────────────────────────────────

export type AutocompleteTrigger = "/" | "@" | "`" | "$";

export function getAutocompleteItems(trigger: AutocompleteTrigger, query: string): readonly IAutocompleteItem[] {
  const normalizedQuery = query.toLowerCase();

  switch (trigger) {
    case "/": {
      const filtered = SLASH_COMMANDS.filter((cmd) => cmd.command.toLowerCase().includes(normalizedQuery));
      return filtered.map((cmd) => ({ label: cmd.command, description: cmd.description }));
    }
    case "@": {
      return CONTEXT_REFS.filter((ref) => ref.label.toLowerCase().includes(normalizedQuery));
    }
    case "`": {
      return CODE_REFS.filter((ref) => ref.label.toLowerCase().includes(normalizedQuery));
    }
    case "$": {
      return SKILL_REFS.filter((ref) => ref.label.toLowerCase().includes(normalizedQuery));
    }
  }
}
