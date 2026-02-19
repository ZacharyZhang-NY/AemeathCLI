/**
 * Message types per PRD sections 7.1, 8.4
 */

import type { ProviderName, ITokenUsage } from "./model.js";

export type { ITokenUsage } from "./model.js";

// ── Chat Messages ────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface IChatMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly model?: string | undefined;
  readonly provider?: ProviderName | undefined;
  readonly toolCalls?: readonly IToolCall[] | undefined;
  readonly tokenUsage?: ITokenUsage | undefined;
  readonly createdAt: Date;
}

// ── Tool Calls ───────────────────────────────────────────────────────────

export interface IToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface IToolResult {
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
  readonly isError: boolean;
}

// ── Streaming ────────────────────────────────────────────────────────────

export type StreamChunkType = "text" | "tool_call" | "usage" | "done" | "error";

export interface IStreamChunk {
  readonly type: StreamChunkType;
  readonly content?: string | undefined;
  readonly toolCall?: IToolCall | undefined;
  readonly usage?: ITokenUsage | undefined;
  readonly error?: string | undefined;
}

// ── Chat Request / Response ──────────────────────────────────────────────

export interface IChatRequest {
  readonly model: string;
  readonly messages: readonly IChatMessage[];
  readonly system?: string | undefined;
  readonly tools?: readonly IToolDefinition[] | undefined;
  readonly maxTokens?: number | undefined;
  readonly temperature?: number | undefined;
}

export interface IChatResponse {
  readonly id: string;
  readonly model: string;
  readonly provider: ProviderName;
  readonly message: IChatMessage;
  readonly usage: ITokenUsage;
  readonly finishReason: "stop" | "tool_calls" | "max_tokens" | "error";
}

// ── Tool Definition ──────────────────────────────────────────────────────

export interface IToolParameter {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly required: boolean;
  readonly default?: unknown | undefined;
  readonly enum?: readonly string[] | undefined;
}

export interface IToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly IToolParameter[];
}

// ── Inter-Agent Messages (PRD section 8.4) ───────────────────────────────

export type AgentMessageType =
  | "message"
  | "broadcast"
  | "shutdown_request"
  | "shutdown_response"
  | "plan_approval_request"
  | "plan_approval_response"
  | "task_update";

export interface IAgentMessage {
  readonly type: AgentMessageType;
  readonly senderId: string;
  readonly recipientId?: string | undefined;
  readonly content: string;
  readonly summary?: string | undefined;
  readonly requestId?: string | undefined;
  readonly approve?: boolean | undefined;
  readonly timestamp: Date;
}
