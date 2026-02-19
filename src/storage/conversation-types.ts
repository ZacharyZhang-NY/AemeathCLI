/**
 * Conversation store types — database row types and public interfaces.
 * Extracted to keep conversation-store.ts under 400 lines.
 */

import type { MessageRole } from "../types/message.js";
import type { ProviderName } from "../types/model.js";

// ── Row Types (database representation) ─────────────────────────────────

export interface IConversationRow {
  readonly id: string;
  readonly project_root: string;
  readonly default_model: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly metadata: string;
}

export interface IMessageRow {
  readonly id: number;
  readonly conversation_id: string;
  readonly role: string;
  readonly model: string | null;
  readonly provider: string | null;
  readonly content: string;
  readonly tool_calls: string | null;
  readonly token_usage: string | null;
  readonly created_at: string;
}

export interface IFileContextRow {
  readonly id: number;
  readonly conversation_id: string;
  readonly file_path: string;
  readonly content_hash: string | null;
  readonly token_count: number | null;
  readonly added_at: string;
}

export interface ICostRow {
  readonly id: number;
  readonly conversation_id: string;
  readonly provider: string;
  readonly model: string;
  readonly role: string | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cost_usd: number | null;
  readonly created_at: string;
}

// ── Public Interfaces ───────────────────────────────────────────────────

export interface IConversation {
  readonly id: string;
  readonly projectRoot: string;
  readonly defaultModel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: Record<string, unknown>;
}

export interface IMessage {
  readonly id: number;
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly model: string | null;
  readonly provider: ProviderName | null;
  readonly content: string;
  readonly toolCalls: unknown[] | null;
  readonly tokenUsage: IStoredTokenUsage | null;
  readonly createdAt: string;
}

export interface IStoredTokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cost: number;
}

export interface IFileContext {
  readonly id: number;
  readonly conversationId: string;
  readonly filePath: string;
  readonly contentHash: string | null;
  readonly tokenCount: number | null;
  readonly addedAt: string;
}

export interface ICostEntry {
  readonly id: number;
  readonly conversationId: string;
  readonly provider: string;
  readonly model: string;
  readonly role: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly createdAt: string;
}

export interface IPaginationOptions {
  readonly limit: number;
  readonly offset: number;
}

export interface IAddMessageParams {
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly model?: string;
  readonly provider?: ProviderName;
  readonly toolCalls?: unknown[];
  readonly tokenUsage?: IStoredTokenUsage;
}

export interface IAddCostParams {
  readonly conversationId: string;
  readonly provider: string;
  readonly model: string;
  readonly role?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

export interface IAddFileContextParams {
  readonly conversationId: string;
  readonly filePath: string;
  readonly contentHash?: string;
  readonly tokenCount?: number;
}
