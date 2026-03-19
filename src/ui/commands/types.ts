/**
 * Shared types for slash command handlers.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { IChatMessage, IAgentState } from "../../types/index.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import { v4Id } from "../utils.js";

export type SelectionMode =
  | { readonly type: "none" }
  | { readonly type: "swarm-onboarding" }
  | { readonly type: "model" }
  | { readonly type: "thinking"; readonly modelId: string }
  | { readonly type: "login" };

export interface IPanelControls {
  readonly setAgents: (agents: readonly IAgentState[]) => void;
  readonly activate: () => void;
  readonly deactivate: () => void;
  readonly appendOutput: (
    agentId: string,
    content: string,
    options?: { readonly immediate?: boolean },
  ) => void;
}

export type SetMessagesDispatch = (
  updater: IChatMessage[] | ((prev: IChatMessage[]) => IChatMessage[]),
) => void;

export interface ICommandContext {
  readonly totalCost: string;
  readonly totalTokens: string;
  readonly setMessages: SetMessagesDispatch;
  readonly modelId: string;
  readonly thinkingValue: string;
  readonly setThinkingValue: (value: string) => void;
  readonly setSelectionMode: (mode: SelectionMode) => void;
  readonly resolution: { readonly provider: string; readonly role?: string | undefined };
  readonly panel: IPanelControls;
  readonly getRegistry: () => Promise<ProviderRegistry>;
  /** Current project root — used for per-project history/resume. */
  readonly projectRoot: string;
}

export function addSystemMessage(ctx: ICommandContext, content: string): void {
  ctx.setMessages((prev) => [
    ...prev,
    {
      id: v4Id(),
      role: "system" as const,
      content,
      createdAt: new Date(),
    },
  ]);
}
