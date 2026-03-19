/**
 * /history and /resume slash command handlers.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { IChatMessage } from "../../types/index.js";
import type { ICommandContext } from "./types.js";
import { addSystemMessage } from "./types.js";
import { v4Id } from "../utils.js";

export async function handleHistoryCommand(ctx: ICommandContext): Promise<void> {
  try {
    const { SqliteStore } = await import("../../storage/sqlite-store.js");
    const { ConversationStore } = await import("../../storage/conversation-store.js");
    const db = new SqliteStore();
    db.open();
    const store = new ConversationStore(db);
    const conversations = store.listConversations(ctx.projectRoot);
    db.close();

    if (conversations.length === 0) {
      addSystemMessage(ctx, "No conversation history for this project.");
      return;
    }

    const lines = conversations.slice(0, 20).map((c, i) => {
      const date = new Date(c.createdAt).toLocaleDateString();
      const model = c.defaultModel ?? "unknown";
      return `  ${String(i + 1).padStart(2)}. ${date}  ${model.padEnd(20)}  ${c.id.slice(0, 8)}\u2026`;
    });
    addSystemMessage(
      ctx,
      `Conversations in this project (${conversations.length} total):\n${lines.join("\n")}\n\nUse /resume <number> or /resume <id> to load.`,
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    addSystemMessage(ctx, `Failed to load history: ${msg}`);
  }
}

export async function handleResumeCommand(
  arg: string | undefined,
  ctx: ICommandContext,
): Promise<void> {
  if (!arg) {
    addSystemMessage(ctx, "Usage: /resume <number> or /resume <conversation-id>\nUse /history to see past conversations.");
    return;
  }

  try {
    const { SqliteStore } = await import("../../storage/sqlite-store.js");
    const { ConversationStore } = await import("../../storage/conversation-store.js");
    const db = new SqliteStore();
    db.open();
    const store = new ConversationStore(db);

    let conversationId: string;

    const num = parseInt(arg, 10);
    if (!isNaN(num) && num > 0) {
      const conversations = store.listConversations(ctx.projectRoot);
      const target = conversations[num - 1];
      if (!target) {
        db.close();
        addSystemMessage(ctx, `Conversation #${num} not found. Use /history to see available.`);
        return;
      }
      conversationId = target.id;
    } else {
      const conversations = store.listConversations(ctx.projectRoot);
      const match = conversations.find((c) => c.id.startsWith(arg));
      if (!match) {
        db.close();
        addSystemMessage(ctx, `No conversation matching "${arg}". Use /history to see available.`);
        return;
      }
      conversationId = match.id;
    }

    const storedMessages = store.getMessages(conversationId);
    db.close();

    if (storedMessages.length === 0) {
      addSystemMessage(ctx, "Conversation found but contains no messages.");
      return;
    }

    const restored: IChatMessage[] = storedMessages.map((m) => ({
      id: v4Id(),
      role: m.role,
      content: m.content,
      model: m.model ?? undefined,
      provider: m.provider ?? undefined,
      createdAt: new Date(m.createdAt),
    }));

    ctx.setMessages(restored);
    addSystemMessage(ctx, `Resumed conversation (${restored.length} messages loaded).`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    addSystemMessage(ctx, `Failed to resume: ${msg}`);
  }
}
