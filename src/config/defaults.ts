import { join } from "node:path";
import { getAemeathHome, getUserSkillsDir } from "../utils/pathResolver.js";
import { PACKAGE_VERSION } from "../version.js";
import type { AemeathConfig } from "./schema.js";

const configDir = getAemeathHome();

export const DEFAULT_AEMEATH_CONFIG: AemeathConfig = {
  version: PACKAGE_VERSION,
  configDir,
  sessionsDir: join(configDir, "sessions"),
  skillsDir: getUserSkillsDir(),
  extensionsDir: join(configDir, "extensions"),
  defaultRole: "coding",
  roles: {
    planning: { primary: "claude-opus-4-6", fallback: ["gpt-5.2", "gemini-2.5-pro"] },
    coding: { primary: "claude-sonnet-4-6", fallback: ["gpt-5.2", "gemini-2.5-flash"] },
    review: { primary: "claude-opus-4-6", fallback: ["gemini-2.5-pro"] },
    testing: { primary: "claude-haiku-4-5", fallback: ["gemini-2.5-flash"] },
    bugfix: { primary: "claude-sonnet-4-6", fallback: ["gpt-5.2"] },
    documentation: { primary: "gemini-2.5-flash", fallback: ["claude-haiku-4-5"] },
  },
  permissions: {
    mode: "standard",
    allowedPaths: [],
    blockedCommands: ["rm -rf /", "git push --force", "git push -f"],
  },
  splitPanel: {
    enabled: true,
    backend: "tmux",
    defaultLayout: "hub-spoke",
    maxPanes: 6,
  },
  teams: {
    enableOrchestratorTools: true,
    maxConcurrentAgents: 4,
  },
  mcp: {
    servers: {},
  },
  cost: {
    budgetWarning: 5,
    budgetHardStop: 20,
    trackPerSession: true,
  },
  customProviders: {},
  extraModels: [],
};
