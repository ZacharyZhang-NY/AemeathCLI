import React from "react";
import { render } from "ink";
import { confirm } from "@inquirer/prompts";
import type { ModelRole } from "../config/schema.js";
import { loadConfig } from "../config/loader.js";
import { createAemeathSession } from "../core/session.js";
import { App } from "../ui/App.js";

export interface IChatRunnerOptions {
  initialMessage?: string | undefined;
  model?: string | undefined;
  role?: string | undefined;
  systemPrompt?: string | undefined;
  streaming?: boolean | undefined;
  print?: boolean | undefined;
}

function isInteractiveTerminal(): boolean {
  return process.stdout.isTTY && process.stdin.isTTY;
}

function normalizeRole(role?: string): ModelRole | undefined {
  switch (role) {
    case "planning":
    case "coding":
    case "review":
    case "testing":
    case "bugfix":
    case "documentation":
      return role;
    default:
      return undefined;
  }
}

async function createTerminalApprovalPrompt(toolName: string, params: Record<string, unknown>): Promise<boolean> {
  if (!isInteractiveTerminal()) {
    return false;
  }

  return confirm({
    message: `Allow tool ${toolName} with arguments ${JSON.stringify(params)}?`,
    default: false,
  });
}

function extractAssistantText(messages: readonly Record<string, unknown>[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.["role"] !== "assistant") {
      continue;
    }

    const content = message["content"];
    if (!Array.isArray(content)) {
      return typeof content === "string" ? content : "";
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
        return [];
      })
      .join("\n");
  }

  return "";
}

export async function runChatCommand(options: IChatRunnerOptions): Promise<void> {
  const config = loadConfig(process.cwd());
  const role = normalizeRole(options.role);
  const session = await createAemeathSession({
    config,
    cwd: process.cwd(),
    role,
    modelOverride: options.model,
    permissionMode: config.permissions.mode,
    onApprovalNeeded: createTerminalApprovalPrompt,
    systemPrompt: options.systemPrompt,
  });

  if (options.print === true || !isInteractiveTerminal()) {
    try {
      if (options.initialMessage && options.initialMessage.trim().length > 0) {
        if (options.streaming !== false) {
          const unsubscribe = session.subscribe((event) => {
            if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
              process.stdout.write(event.assistantMessageEvent.delta);
            }
          });
          await session.prompt(options.initialMessage);
          unsubscribe();
          process.stdout.write("\n");
        } else {
          await session.prompt(options.initialMessage);
          const text = extractAssistantText(session.agent.state.messages as unknown as Record<string, unknown>[]);
          if (text.length > 0) {
            process.stdout.write(`${text}\n`);
          }
        }
      }
      return;
    } finally {
      session.dispose();
    }
  }

  const app = render(
    React.createElement(App, {
      session,
      config,
      initialMessage: options.initialMessage,
      role,
    }),
  );

  await app.waitUntilExit();
  session.dispose();
}
