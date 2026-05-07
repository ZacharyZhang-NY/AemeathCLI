import { z } from "zod";

export const PermissionModeSchema = z.enum(["strict", "standard", "permissive"]);
export const ModelRoleSchema = z.enum([
  "planning",
  "coding",
  "review",
  "testing",
  "bugfix",
  "documentation",
]);
export const PaneBackendSchema = z.enum(["tmux", "iterm2", "ghostty", "terminal-app"]);
export const PaneLayoutSchema = z.enum(["auto", "horizontal", "vertical", "grid", "hub-spoke"]);

export const RoleConfigSchema = z.object({
  primary: z.string().min(1),
  fallback: z.array(z.string()).default([]),
});

export const RolesSchema = z.object({
  planning: RoleConfigSchema,
  coding: RoleConfigSchema,
  review: RoleConfigSchema,
  testing: RoleConfigSchema,
  bugfix: RoleConfigSchema,
  documentation: RoleConfigSchema,
});

export const PermissionConfigSchema = z.object({
  mode: PermissionModeSchema.default("standard"),
  allowedPaths: z.array(z.string()).default([]),
  blockedCommands: z.array(z.string()).default([]),
});

export const SplitPanelConfigSchema = z.object({
  enabled: z.boolean().default(true),
  backend: PaneBackendSchema.default("tmux"),
  defaultLayout: PaneLayoutSchema.default("auto"),
  maxPanes: z.number().int().min(1).max(16).default(4),
});

export const TeamsConfigSchema = z.object({
  enableOrchestratorTools: z.boolean().default(true),
  maxConcurrentAgents: z.number().int().min(1).max(16).default(4),
});

export const MCPServerSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string()).optional(),
});

export const MCPConfigSchema = z.object({
  servers: z.record(MCPServerSchema).default({}),
});

export const CostConfigSchema = z.object({
  budgetWarning: z.number().nonnegative().default(1),
  budgetHardStop: z.number().nonnegative().default(5),
  trackPerSession: z.boolean().default(true),
});

export const CustomProviderSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  api: z.string(),
  models: z.array(z.unknown()).default([]),
  oauth: z.unknown().optional(),
  headers: z.record(z.string()).optional(),
}).passthrough();

export const AemeathConfigSchema = z.object({
  version: z.string(),
  configDir: z.string(),
  sessionsDir: z.string(),
  skillsDir: z.string(),
  extensionsDir: z.string(),
  defaultRole: ModelRoleSchema.default("coding"),
  roles: RolesSchema,
  permissions: PermissionConfigSchema,
  splitPanel: SplitPanelConfigSchema,
  teams: TeamsConfigSchema,
  mcp: MCPConfigSchema.default({ servers: {} }),
  cost: CostConfigSchema,
  customProviders: z.record(CustomProviderSchema).default({}),
  extraModels: z.array(z.unknown()).default([]),
}).passthrough();

export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export type ModelRole = z.infer<typeof ModelRoleSchema>;
export type PaneBackend = z.infer<typeof PaneBackendSchema>;
export type PaneLayout = z.infer<typeof PaneLayoutSchema>;
export type RoleConfig = z.infer<typeof RoleConfigSchema>;
export type AemeathConfig = z.infer<typeof AemeathConfigSchema>;
