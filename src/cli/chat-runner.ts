import { randomUUID } from "node:crypto";

import { createModelRouter } from "../core/model-router.js";
import { createDefaultRegistry } from "../providers/registry.js";
import { ConfigStore } from "../storage/config-store.js";
import type { IChatMessage } from "../types/message.js";
import type { ModelRole } from "../types/model.js";

const VALID_ROLES: readonly ModelRole[] = [
  "planning",
  "coding",
  "review",
  "testing",
  "bugfix",
  "documentation",
] as const;

export interface IChatRunnerOptions {
  readonly initialMessage?: string | undefined;
  readonly model?: string | undefined;
  readonly role?: string | undefined;
  readonly systemPrompt?: string | undefined;
  readonly streaming?: boolean | undefined;
  readonly isAgentPane?: boolean | undefined;
  readonly print?: boolean | undefined;
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

function normalizeMessage(message: string | undefined): string | undefined {
  const trimmed = message?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parseRole(role: string | undefined): ModelRole | undefined {
  if (role === undefined) {
    return undefined;
  }

  if ((VALID_ROLES as readonly string[]).includes(role)) {
    return role as ModelRole;
  }

  throw new Error(`Unknown role "${role}". Valid roles: ${VALID_ROLES.join(", ")}`);
}

async function ensureInteractiveConfig(): Promise<void> {
  const { ensureDefaultConfig, hasGlobalConfig } = await import("./setup/first-run.js");

  if (!hasGlobalConfig()) {
    ensureDefaultConfig();
  }
}

async function startInteractiveChat(options: IChatRunnerOptions): Promise<void> {
  await ensureInteractiveConfig();

  const { startChatSession } = await import("../ui/App.js");
  await startChatSession({
    ...(options.initialMessage !== undefined ? { initialMessage: options.initialMessage } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.role !== undefined ? { role: options.role } : {}),
    ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.isAgentPane ? { isAgentPane: true } : {}),
    streaming: options.streaming !== false,
  });
}

async function runPlainChat(options: IChatRunnerOptions, message: string): Promise<void> {
  const config = new ConfigStore().loadGlobal();
  const modelRouter = createModelRouter(config);
  const role = parseRole(options.role);

  if (options.model !== undefined) {
    modelRouter.setUserOverride(options.model);
  }

  const resolution = modelRouter.resolve(role);
  const registry = await createDefaultRegistry();

  if (!registry.hasModel(resolution.modelId)) {
    throw new Error(
      `No provider is available for model "${resolution.modelId}". Run \`aemeathcli auth status\` or \`aemeathcli auth set-key <provider>\`.`,
    );
  }

  const provider = registry.getForModel(resolution.modelId);
  const messages: readonly IChatMessage[] = [
    {
      id: randomUUID(),
      role: "user",
      content: message,
      createdAt: new Date(),
    },
  ];

  if (options.streaming === false) {
    const response = await provider.chat({
      model: resolution.modelId,
      messages,
      ...(options.systemPrompt !== undefined ? { system: options.systemPrompt } : {}),
    });
    process.stdout.write(`${response.message.content}\n`);
    return;
  }

  let wroteOutput = false;

  for await (const chunk of provider.stream({
    model: resolution.modelId,
    messages,
    ...(options.systemPrompt !== undefined ? { system: options.systemPrompt } : {}),
  })) {
    if (chunk.type === "text" && chunk.content) {
      process.stdout.write(chunk.content);
      wroteOutput = true;
      continue;
    }

    if (chunk.type === "tool_call") {
      throw new Error(
        "Tool-calling output is not supported in plain mode. Use the interactive TUI (`aemeathcli`) and switch into swarm mode with Shift+Tab.",
      );
    }

    if (chunk.type === "error" && chunk.error) {
      throw new Error(chunk.error);
    }
  }

  if (wroteOutput) {
    process.stdout.write("\n");
  }
}

export async function runChatCommand(options: IChatRunnerOptions): Promise<void> {
  const message = normalizeMessage(options.initialMessage);
  const interactive = isInteractiveTerminal();

  if (!options.print && interactive && message === undefined) {
    await startInteractiveChat(options);
    return;
  }

  if (message === undefined) {
    throw new Error(
      "Interactive mode requires a TTY. Provide a prompt for one-shot mode or run the command in a terminal.",
    );
  }

  await runPlainChat(options, message);
}
