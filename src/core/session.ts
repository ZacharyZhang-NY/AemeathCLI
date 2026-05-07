import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import type { AemeathConfig, ModelRole, PermissionMode } from "../config/schema.js";
import { buildAemeathTools } from "../tools/registry.js";
import { createAemeathAuthStorage } from "./auth.js";
import { createAemeathModelRegistry } from "./model-registry.js";
import { RoleRouter } from "./role-router.js";

export interface AemeathSessionOptions {
  config: AemeathConfig;
  cwd: string;
  role?: ModelRole | undefined;
  modelOverride?: string | undefined;
  permissionMode?: PermissionMode | undefined;
  onApprovalNeeded?: ((toolName: string, params: Record<string, unknown>) => Promise<boolean>) | undefined;
  systemPrompt?: string | undefined;
}

function buildSystemPrompt(cwd: string, role: ModelRole, override?: string): string {
  const base = [
    `You are AemeathCLI running in ${cwd}.`,
    `Current role: ${role}.`,
    "Be direct, technically correct, and finish the job instead of narrating intentions.",
    "Use tools when they materially improve correctness, and do not invent results.",
  ].join(" ");

  if (!override || override.trim().length === 0) {
    return base;
  }

  return `${base}\n\nAdditional instructions:\n${override.trim()}`;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) {
        return [];
      }

      const record = part as Record<string, unknown>;
      if (record["type"] === "text" && typeof record["text"] === "string") {
        return [record["text"]];
      }

      if (record["type"] === "thinking" && typeof record["thinking"] === "string") {
        return [record["thinking"]];
      }

      return [];
    })
    .join("\n");
}

function getLastAssistantText(session: AgentSession): string {
  const messages = session.agent.state.messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as unknown as Record<string, unknown>;
    if (message["role"] === "assistant") {
      return extractTextContent(message["content"]);
    }
  }

  return "";
}

export async function createAemeathSession(options: AemeathSessionOptions): Promise<AgentSession> {
  const role = options.role ?? options.config.defaultRole;
  const permissionMode = options.permissionMode ?? options.config.permissions.mode;
  const onApprovalNeeded =
    options.onApprovalNeeded ??
    (() => Promise.resolve(false));

  const authStorage = createAemeathAuthStorage(options.config);
  const modelRegistry = createAemeathModelRegistry(options.config, authStorage);
  const roleRouter = new RoleRouter(modelRegistry, options.config);
  const resolvedModel = roleRouter.resolve(role, options.modelOverride);

  const tools = buildAemeathTools({
    cwd: options.cwd,
    projectRoot: options.cwd,
    permissionMode,
    allowedPaths: options.config.permissions.allowedPaths,
    blockedCommands: options.config.permissions.blockedCommands,
    onApprovalNeeded,
    spawnSubagent: async (prompt, spawnOptions) => {
      const subSession = await createAemeathSession({
        config: options.config,
        cwd: options.cwd,
        role: (spawnOptions?.role as ModelRole | undefined) ?? role,
        modelOverride: spawnOptions?.model,
        permissionMode,
        onApprovalNeeded,
      });

      try {
        await subSession.prompt(prompt);
        return getLastAssistantText(subSession);
      } finally {
        subSession.dispose();
      }
    },
  });

  const createSessionOptions = {
    cwd: options.cwd,
    agentDir: options.config.configDir,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.create(options.cwd, options.config.sessionsDir),
    settingsManager: SettingsManager.create(options.cwd, options.config.configDir),
    tools: [],
    customTools: tools,
  };

  const { session } = await createAgentSession(
    resolvedModel ? { ...createSessionOptions, model: resolvedModel } : createSessionOptions,
  );

  session.agent.state.systemPrompt = buildSystemPrompt(options.cwd, role, options.systemPrompt);
  return session;
}
