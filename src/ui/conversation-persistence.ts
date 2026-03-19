/**
 * Conversation persistence to SQLite.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { IChatMessage, ProviderName } from "../types/index.js";
import type { ConversationStore } from "../storage/conversation-store.js";

/** Lazily-initialized conversation DB reference. */
let convDbRef: { store: ConversationStore; convId: string } | undefined;

export async function persistMessages(
  projectRoot: string,
  userMsg: IChatMessage,
  assistantMsg: IChatMessage,
  model: string,
  provider: ProviderName,
): Promise<void> {
  try {
    const { SqliteStore } = await import("../storage/sqlite-store.js");
    const { ConversationStore } = await import("../storage/conversation-store.js");

    if (!convDbRef) {
      const db = new SqliteStore();
      db.open();
      const store = new ConversationStore(db);
      const conv = store.createConversation(projectRoot, model);
      convDbRef = { store, convId: conv.id };
    }

    const { store, convId } = convDbRef;

    store.addMessage({
      conversationId: convId,
      role: "user",
      content: userMsg.content,
    });

    store.addMessage({
      conversationId: convId,
      role: "assistant",
      model,
      provider,
      content: assistantMsg.content,
    });
  } catch (error: unknown) {
    // Non-critical — don't break the chat, but log for diagnostics
    const { logger } = await import("../utils/logger.js");
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: msg }, "Conversation persistence failed");
  }
}
