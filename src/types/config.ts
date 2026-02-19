/**
 * Configuration types per PRD section 17.3
 */

import type { ProviderName, ModelRole, IRoleConfig } from "./model.js";
import type { PermissionMode } from "./tool.js";
import type { PaneLayout } from "./team.js";

// ── Provider Configuration ───────────────────────────────────────────────

export interface IProviderConfig {
  readonly enabled: boolean;
  readonly baseUrl?: string | undefined;
}

// ── Permission Configuration ─────────────────────────────────────────────

export interface IPermissionConfig {
  readonly mode: PermissionMode;
  readonly allowedPaths: readonly string[];
  readonly blockedCommands: readonly string[];
}

// ── Split Panel Configuration ────────────────────────────────────────────

export type PaneBackend = "tmux" | "iterm2";

export interface ISplitPanelConfig {
  readonly enabled: boolean;
  readonly backend: PaneBackend;
  readonly defaultLayout: PaneLayout;
  readonly maxPanes: number;
}

// ── Cost Configuration ───────────────────────────────────────────────────

export interface ICostConfig {
  readonly budgetWarning: number;
  readonly budgetHardStop: number;
  readonly currency: string;
}

// ── Telemetry Configuration ──────────────────────────────────────────────

export interface ITelemetryConfig {
  readonly enabled: boolean;
  readonly anonymized: boolean;
}

// ── OAuth Provider Configuration ─────────────────────────────────────────

export interface IOAuthProviderConfig {
  readonly clientId: string;
  readonly clientSecret?: string | undefined;
  readonly authorizeUrl?: string | undefined;
  readonly tokenUrl?: string | undefined;
  readonly scope?: string | undefined;
}

export interface IOAuthConfig {
  readonly anthropic?: IOAuthProviderConfig | undefined;
  readonly openai?: IOAuthProviderConfig | undefined;
  readonly google?: IOAuthProviderConfig | undefined;
  readonly kimi?: IOAuthProviderConfig | undefined;
}

// ── Global Configuration (PRD section 17.3) ──────────────────────────────

export interface IGlobalConfig {
  readonly version: string;
  readonly defaultModel: string;
  readonly roles: Partial<Record<ModelRole, IRoleConfig>>;
  readonly providers: Partial<Record<ProviderName, IProviderConfig>>;
  readonly permissions: IPermissionConfig;
  readonly splitPanel: ISplitPanelConfig;
  readonly cost: ICostConfig;
  readonly telemetry: ITelemetryConfig;
  readonly oauth?: IOAuthConfig | undefined;
}

// ── MCP Server Configuration (PRD section 11.2) ─────────────────────────

export interface IMCPServerConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export interface IMCPConfig {
  readonly mcpServers: Readonly<Record<string, IMCPServerConfig>>;
}

// ── Skill Configuration (PRD section 10.2) ───────────────────────────────

export interface ISkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly "allowed-tools"?: readonly string[] | undefined;
  readonly triggers: readonly string[];
  readonly "model-requirements"?: {
    readonly "preferred-role"?: ModelRole | undefined;
    readonly "min-context"?: number | undefined;
  } | undefined;
}

export interface ISkillDefinition {
  readonly frontmatter: ISkillFrontmatter;
  readonly body: string;
  readonly filePath: string;
}

// ── Auth Credential Types (PRD section 13) ───────────────────────────────

export type AuthMethod = "native_login" | "api_key" | "env_variable" | "credential_helper";

export interface ICredential {
  readonly provider: ProviderName;
  readonly method: AuthMethod;
  readonly token?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly expiresAt?: Date | undefined;
  readonly email?: string | undefined;
  readonly plan?: string | undefined;
}

// ── Default Configuration ────────────────────────────────────────────────

export const DEFAULT_CONFIG: IGlobalConfig = {
  version: "1.0.0",
  defaultModel: "claude-sonnet-4-6",
  roles: {
    planning: { primary: "claude-opus-4-6", fallback: ["gpt-5.2", "gemini-2.5-pro"] },
    coding: { primary: "claude-sonnet-4-6", fallback: ["gpt-5.2", "gemini-2.5-flash"] },
    review: { primary: "claude-opus-4-6", fallback: ["gemini-2.5-pro"] },
    testing: { primary: "claude-haiku-4-5", fallback: ["gemini-2.5-flash"] },
    bugfix: { primary: "claude-sonnet-4-6", fallback: ["gpt-5.2"] },
    documentation: { primary: "gemini-2.5-flash", fallback: ["claude-haiku-4-5"] },
  },
  providers: {
    anthropic: { enabled: true },
    openai: { enabled: true },
    google: { enabled: true },
    kimi: { enabled: false },
    ollama: { enabled: false, baseUrl: "http://localhost:11434" },
  },
  permissions: {
    mode: "standard",
    allowedPaths: ["./"],
    blockedCommands: ["rm -rf /", "git push --force"],
  },
  splitPanel: {
    enabled: true,
    backend: "tmux",
    defaultLayout: "auto",
    maxPanes: 6,
  },
  cost: {
    budgetWarning: 5.0,
    budgetHardStop: 20.0,
    currency: "USD",
  },
  telemetry: {
    enabled: false,
    anonymized: true,
  },
};
