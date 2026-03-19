/**
 * Autocomplete data definitions for InputBar triggers.
 * Skills are dynamically discovered from disk at startup.
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
  { command: "/login", description: "Log in to a provider (interactive)" },
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
  { command: "/panel", description: "Show swarm layout information" },
  { command: "/login status", description: "Show login status for all providers" },
  { command: "/login logout", description: "Log out of a provider" },
  { command: "/config get", description: "Get a configuration value" },
  { command: "/config set", description: "Set a configuration value" },
  { command: "/history", description: "List past conversations" },
  { command: "/resume", description: "Resume a past conversation by number or ID" },
  { command: "/quit", description: "Exit" },
  { command: "/exit", description: "Exit" },
];

// ── Context References (@) ──────────────────────────────────────────────────

const BUILTIN_CONTEXT_REFS: readonly IAutocompleteItem[] = [
  { label: "@codebase", description: "Reference the entire codebase" },
  { label: "@git", description: "Reference git state" },
  { label: "@docs", description: "Reference project docs" },
  { label: "@web", description: "Reference web context" },
];

let dynamicFileRefs: readonly IAutocompleteItem[] = [];

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

// ── Skill Invocation ($) — dynamically populated ────────────────────────────

/** Fallback built-in skills shown before dynamic discovery completes. */
const BUILTIN_SKILL_REFS: readonly IAutocompleteItem[] = [
  { label: "$review", description: "Comprehensive code review" },
  { label: "$commit", description: "Smart git commit with message generation" },
  { label: "$plan", description: "Create implementation plan from requirements" },
  { label: "$debug", description: "Systematic debugging workflow" },
  { label: "$test", description: "Generate tests for code" },
  { label: "$refactor", description: "Refactoring with safety checks" },
];

/**
 * Mutable skill list — starts with built-ins, then gets replaced
 * by the full set once SkillRegistry finishes scanning disk.
 */
let dynamicSkillRefs: readonly IAutocompleteItem[] = BUILTIN_SKILL_REFS;

/**
 * Replace the skill autocomplete list with dynamically discovered skills.
 * Called from App.tsx after SkillRegistry.initialize() completes.
 */
export function registerDynamicSkills(skills: readonly IAutocompleteItem[]): void {
  dynamicSkillRefs = skills.length > 0 ? skills : BUILTIN_SKILL_REFS;
}

/** Current skill list (dynamic once loaded, built-in fallback otherwise). */
export function getSkillRefs(): readonly IAutocompleteItem[] {
  return dynamicSkillRefs;
}

export function registerDynamicFileRefs(files: readonly IAutocompleteItem[]): void {
  dynamicFileRefs = files;
}

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
      const fileMatches = dynamicFileRefs.filter((ref) => ref.label.toLowerCase().includes(normalizedQuery));
      const builtinMatches = BUILTIN_CONTEXT_REFS.filter((ref) => ref.label.toLowerCase().includes(normalizedQuery));
      return [...fileMatches, ...builtinMatches];
    }
    case "`": {
      return CODE_REFS.filter((ref) => ref.label.toLowerCase().includes(normalizedQuery));
    }
    case "$": {
      return dynamicSkillRefs.filter((ref) => ref.label.toLowerCase().includes(normalizedQuery));
    }
  }
}
