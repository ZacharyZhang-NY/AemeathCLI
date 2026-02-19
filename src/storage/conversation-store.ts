/**
 * Conversation store — PRD section 17.1
 * CRUD for conversations, messages, file context, and cost tracking.
 * All queries use parameterized prepared statements.
 */

import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import type { SqliteStore } from "./sqlite-store.js";
import type { MessageRole } from "../types/message.js";
import type { ProviderName } from "../types/model.js";
import type {
  IConversationRow,
  IMessageRow,
  IFileContextRow,
  ICostRow,
  IConversation,
  IMessage,
  IStoredTokenUsage,
  IFileContext,
  ICostEntry,
  IPaginationOptions,
  IAddMessageParams,
  IAddCostParams,
  IAddFileContextParams,
} from "./conversation-types.js";

export type {
  IConversation,
  IMessage,
  IStoredTokenUsage,
  IFileContext,
  ICostEntry,
  IPaginationOptions,
  IAddMessageParams,
  IAddCostParams,
  IAddFileContextParams,
} from "./conversation-types.js";

export class ConversationStore {
  private readonly store: SqliteStore;

  constructor(store: SqliteStore) {
    this.store = store;
  }

  createConversation(
    projectRoot: string,
    defaultModel?: string,
    metadata?: Record<string, unknown>,
  ): IConversation {
    const id = randomUUID();
    const metadataJson = JSON.stringify(metadata ?? {});

    this.store.run(
      `INSERT INTO conversations (id, project_root, default_model, metadata)
       VALUES (?, ?, ?, ?)`,
      id,
      projectRoot,
      defaultModel ?? null,
      metadataJson,
    );

    logger.info({ conversationId: id, projectRoot }, "Conversation created");

    const row = this.store.get<IConversationRow>(
      "SELECT * FROM conversations WHERE id = ?",
      id,
    );

    if (!row) {
      throw new Error(`Failed to retrieve created conversation: ${id}`);
    }

    return this.mapConversationRow(row);
  }

  getConversation(id: string): IConversation | undefined {
    const row = this.store.get<IConversationRow>(
      "SELECT * FROM conversations WHERE id = ?",
      id,
    );
    return row ? this.mapConversationRow(row) : undefined;
  }

  listConversations(projectRoot?: string): IConversation[] {
    const rows = projectRoot
      ? this.store.all<IConversationRow>(
          "SELECT * FROM conversations WHERE project_root = ? ORDER BY updated_at DESC",
          projectRoot,
        )
      : this.store.all<IConversationRow>(
          "SELECT * FROM conversations ORDER BY updated_at DESC",
        );

    return rows.map((row) => this.mapConversationRow(row));
  }

  deleteConversation(id: string): void {
    this.store.run("DELETE FROM conversations WHERE id = ?", id);
    logger.info({ conversationId: id }, "Conversation deleted");
  }

  addMessage(params: IAddMessageParams): IMessage {
    const toolCallsJson = params.toolCalls
      ? JSON.stringify(params.toolCalls)
      : null;
    const tokenUsageJson = params.tokenUsage
      ? JSON.stringify(params.tokenUsage)
      : null;

    const result = this.store.run(
      `INSERT INTO messages
       (conversation_id, role, model, provider, content, tool_calls, token_usage)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params.conversationId,
      params.role,
      params.model ?? null,
      params.provider ?? null,
      params.content,
      toolCallsJson,
      tokenUsageJson,
    );

    this.store.run(
      "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
      params.conversationId,
    );

    const row = this.store.get<IMessageRow>(
      "SELECT * FROM messages WHERE id = ?",
      result.lastInsertRowid,
    );

    if (!row) {
      throw new Error("Failed to retrieve created message");
    }

    return this.mapMessageRow(row);
  }

  getMessages(
    conversationId: string,
    pagination?: IPaginationOptions,
  ): IMessage[] {
    const limit = pagination?.limit ?? 100;
    const offset = pagination?.offset ?? 0;

    const rows = this.store.all<IMessageRow>(
      `SELECT * FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`,
      conversationId,
      limit,
      offset,
    );

    return rows.map((row) => this.mapMessageRow(row));
  }

  getMessageCount(conversationId: string): number {
    const result = this.store.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?",
      conversationId,
    );
    return result?.count ?? 0;
  }

  addFileContext(params: IAddFileContextParams): IFileContext {
    const result = this.store.run(
      `INSERT INTO file_context
       (conversation_id, file_path, content_hash, token_count)
       VALUES (?, ?, ?, ?)`,
      params.conversationId,
      params.filePath,
      params.contentHash ?? null,
      params.tokenCount ?? null,
    );

    const row = this.store.get<IFileContextRow>(
      "SELECT * FROM file_context WHERE id = ?",
      result.lastInsertRowid,
    );

    if (!row) {
      throw new Error("Failed to retrieve created file context");
    }

    return this.mapFileContextRow(row);
  }

  getFileContext(conversationId: string): IFileContext[] {
    const rows = this.store.all<IFileContextRow>(
      "SELECT * FROM file_context WHERE conversation_id = ? ORDER BY added_at DESC",
      conversationId,
    );
    return rows.map((row) => this.mapFileContextRow(row));
  }

  removeFileContext(conversationId: string, filePath: string): void {
    this.store.run(
      "DELETE FROM file_context WHERE conversation_id = ? AND file_path = ?",
      conversationId,
      filePath,
    );
  }

  addCost(params: IAddCostParams): ICostEntry {
    const result = this.store.run(
      `INSERT INTO cost_tracking
       (conversation_id, provider, model, role, input_tokens, output_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params.conversationId,
      params.provider,
      params.model,
      params.role ?? null,
      params.inputTokens ?? null,
      params.outputTokens ?? null,
      params.costUsd ?? null,
    );

    const row = this.store.get<ICostRow>(
      "SELECT * FROM cost_tracking WHERE id = ?",
      result.lastInsertRowid,
    );

    if (!row) {
      throw new Error("Failed to retrieve created cost entry");
    }

    return this.mapCostRow(row);
  }

  getConversationCost(conversationId: string): number {
    const result = this.store.get<{ total: number | null }>(
      "SELECT SUM(cost_usd) as total FROM cost_tracking WHERE conversation_id = ?",
      conversationId,
    );
    return result?.total ?? 0;
  }

  getCostBreakdown(conversationId: string): ICostEntry[] {
    const rows = this.store.all<ICostRow>(
      "SELECT * FROM cost_tracking WHERE conversation_id = ? ORDER BY created_at ASC",
      conversationId,
    );
    return rows.map((row) => this.mapCostRow(row));
  }

  // ── Private row mappers ─────────────────────────────────────────────

  private mapConversationRow(row: IConversationRow): IConversation {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = {};
    }

    return {
      id: row.id,
      projectRoot: row.project_root,
      defaultModel: row.default_model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata,
    };
  }

  private mapMessageRow(row: IMessageRow): IMessage {
    let toolCalls: unknown[] | null = null;
    if (row.tool_calls) {
      try {
        toolCalls = JSON.parse(row.tool_calls) as unknown[];
      } catch {
        toolCalls = null;
      }
    }

    let tokenUsage: IStoredTokenUsage | null = null;
    if (row.token_usage) {
      try {
        tokenUsage = JSON.parse(row.token_usage) as IStoredTokenUsage;
      } catch {
        tokenUsage = null;
      }
    }

    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as MessageRole,
      model: row.model,
      provider: row.provider as ProviderName | null,
      content: row.content,
      toolCalls,
      tokenUsage,
      createdAt: row.created_at,
    };
  }

  private mapFileContextRow(row: IFileContextRow): IFileContext {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      filePath: row.file_path,
      contentHash: row.content_hash,
      tokenCount: row.token_count,
      addedAt: row.added_at,
    };
  }

  private mapCostRow(row: ICostRow): ICostEntry {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      provider: row.provider,
      model: row.model,
      role: row.role,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
      createdAt: row.created_at,
    };
  }
}
