/**
 * Tests for StateStore — SQLite persistence for orchestrator state.
 *
 * Uses real better-sqlite3 with temporary file-based databases per test.
 * No mocking needed since SQLite is a local, side-effect-free database.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StateStore } from "../../src/orchestrator/state-store.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";

describe("StateStore", () => {
  let store: StateStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `test-statestore-${randomUUID()}.db`);
    store = new StateStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // Already closed
    }
    // Clean up temp database files
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {
        // File may not exist
      }
    }
  });

  // ── Terminal CRUD ──────────────────────────────────────────────────────

  describe("Terminal CRUD", () => {
    it("creates and retrieves a terminal", () => {
      store.createTerminal({
        id: "t1",
        sessionId: "s1",
        provider: "claude-code",
        agentProfile: "developer",
        status: "idle",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      });

      const terminals = store.listTerminals("s1");
      expect(terminals).toHaveLength(1);

      const terminal = terminals[0];
      expect(terminal).toBeDefined();
      expect(terminal!.id).toBe("t1");
      expect(terminal!.sessionId).toBe("s1");
      expect(terminal!.provider).toBe("claude-code");
      expect(terminal!.agentProfile).toBe("developer");
      expect(terminal!.status).toBe("idle");
    });

    it("creates terminal with undefined agentProfile", () => {
      store.createTerminal({
        id: "t2",
        sessionId: "s1",
        provider: "codex",
        status: "idle",
        createdAt: new Date(),
      });

      const terminals = store.listTerminals("s1");
      expect(terminals).toHaveLength(1);
      expect(terminals[0]!.agentProfile).toBeUndefined();
    });

    it("retrieves terminal by ID", () => {
      store.createTerminal({
        id: "t3",
        sessionId: "s1",
        provider: "gemini-cli",
        agentProfile: "reviewer",
        status: "processing",
        createdAt: new Date(),
      });

      const terminal = store.getTerminal("t3");
      expect(terminal).toBeDefined();
      expect(terminal!.id).toBe("t3");
      expect(terminal!.provider).toBe("gemini-cli");
      expect(terminal!.agentProfile).toBe("reviewer");
      expect(terminal!.status).toBe("processing");
    });

    it("returns undefined for non-existent terminal", () => {
      const terminal = store.getTerminal("nonexistent");
      expect(terminal).toBeUndefined();
    });

    it("updates terminal status", () => {
      store.createTerminal({
        id: "t4",
        sessionId: "s1",
        provider: "kimi-cli",
        status: "idle",
        createdAt: new Date(),
      });

      store.updateTerminalStatus("t4", "processing");
      const terminal = store.getTerminal("t4");
      expect(terminal!.status).toBe("processing");

      store.updateTerminalStatus("t4", "completed");
      const updated = store.getTerminal("t4");
      expect(updated!.status).toBe("completed");
    });

    it("deletes a terminal", () => {
      store.createTerminal({
        id: "t5",
        sessionId: "s1",
        provider: "ollama",
        status: "idle",
        createdAt: new Date(),
      });

      expect(store.getTerminal("t5")).toBeDefined();

      store.deleteTerminal("t5");
      expect(store.getTerminal("t5")).toBeUndefined();
    });

    it("delete is idempotent for non-existent terminal", () => {
      expect(() => store.deleteTerminal("nonexistent")).not.toThrow();
    });

    it("lists only terminals for a specific session", () => {
      store.createTerminal({
        id: "t10",
        sessionId: "session-a",
        provider: "claude-code",
        status: "idle",
        createdAt: new Date(),
      });
      store.createTerminal({
        id: "t11",
        sessionId: "session-b",
        provider: "codex",
        status: "idle",
        createdAt: new Date(),
      });
      store.createTerminal({
        id: "t12",
        sessionId: "session-a",
        provider: "gemini-cli",
        status: "idle",
        createdAt: new Date(),
      });

      const sessionA = store.listTerminals("session-a");
      expect(sessionA).toHaveLength(2);
      expect(sessionA.map((t) => t.id)).toContain("t10");
      expect(sessionA.map((t) => t.id)).toContain("t12");

      const sessionB = store.listTerminals("session-b");
      expect(sessionB).toHaveLength(1);
      expect(sessionB[0]!.id).toBe("t11");
    });

    it("returns empty array for session with no terminals", () => {
      const terminals = store.listTerminals("empty-session");
      expect(terminals).toHaveLength(0);
    });

    it("lists terminals ordered by creation time", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");

      store.createTerminal({
        id: "t-third",
        sessionId: "s1",
        provider: "claude-code",
        status: "idle",
        createdAt: new Date(baseTime.getTime() + 2000),
      });
      store.createTerminal({
        id: "t-first",
        sessionId: "s1",
        provider: "codex",
        status: "idle",
        createdAt: new Date(baseTime.getTime()),
      });
      store.createTerminal({
        id: "t-second",
        sessionId: "s1",
        provider: "gemini-cli",
        status: "idle",
        createdAt: new Date(baseTime.getTime() + 1000),
      });

      const terminals = store.listTerminals("s1");
      expect(terminals).toHaveLength(3);
      expect(terminals[0]!.id).toBe("t-first");
      expect(terminals[1]!.id).toBe("t-second");
      expect(terminals[2]!.id).toBe("t-third");
    });
  });

  // ── Inbox Operations ──────────────────────────────────────────────────

  describe("Inbox Operations", () => {
    it("queues a message and returns a positive ID", () => {
      const id = store.queueMessage({
        from: "supervisor",
        to: "worker1",
        content: "Do the task",
      });
      expect(id).toBeGreaterThan(0);
    });

    it("retrieves pending messages for a receiver", () => {
      store.queueMessage({
        from: "supervisor",
        to: "worker1",
        content: "Task 1",
      });
      store.queueMessage({
        from: "supervisor",
        to: "worker1",
        content: "Task 2",
      });

      const pending = store.getPendingMessages("worker1");
      expect(pending).toHaveLength(2);
      expect(pending[0]!.content).toBe("Task 1");
      expect(pending[1]!.content).toBe("Task 2");
    });

    it("returns empty array when no pending messages", () => {
      const pending = store.getPendingMessages("no-messages");
      expect(pending).toHaveLength(0);
    });

    it("only returns pending messages, not delivered or failed", () => {
      const id1 = store.queueMessage({
        from: "sup",
        to: "w1",
        content: "msg1",
      });
      store.queueMessage({
        from: "sup",
        to: "w1",
        content: "msg2",
      });
      const id3 = store.queueMessage({
        from: "sup",
        to: "w1",
        content: "msg3",
      });

      store.markDelivered(id1);
      store.markFailed(id3);

      const pending = store.getPendingMessages("w1");
      expect(pending).toHaveLength(1);
      expect(pending[0]!.content).toBe("msg2");
    });

    it("marks a message as delivered", () => {
      const id = store.queueMessage({
        from: "sup",
        to: "w1",
        content: "deliver this",
      });

      store.markDelivered(id);

      const pending = store.getPendingMessages("w1");
      expect(pending).toHaveLength(0);

      const all = store.getAllMessages("w1");
      expect(all).toHaveLength(1);
      expect(all[0]!.status).toBe("delivered");
      expect(all[0]!.deliveredAt).toBeDefined();
    });

    it("marks a message as failed", () => {
      const id = store.queueMessage({
        from: "sup",
        to: "w1",
        content: "fail this",
      });

      store.markFailed(id);

      const pending = store.getPendingMessages("w1");
      expect(pending).toHaveLength(0);

      const all = store.getAllMessages("w1");
      expect(all).toHaveLength(1);
      expect(all[0]!.status).toBe("failed");
    });

    it("retrieves all messages regardless of status", () => {
      const id1 = store.queueMessage({
        from: "sup",
        to: "w2",
        content: "pending",
      });
      const id2 = store.queueMessage({
        from: "sup",
        to: "w2",
        content: "delivered",
      });
      const id3 = store.queueMessage({
        from: "sup",
        to: "w2",
        content: "failed",
      });

      store.markDelivered(id2);
      store.markFailed(id3);

      const all = store.getAllMessages("w2");
      expect(all).toHaveLength(3);

      const statuses = all.map((m) => m.status);
      expect(statuses).toContain("pending");
      expect(statuses).toContain("delivered");
      expect(statuses).toContain("failed");

      // Suppress unused variable warnings
      void id1;
    });

    it("messages have correct sender and receiver", () => {
      store.queueMessage({
        from: "agent-a",
        to: "agent-b",
        content: "hello",
      });

      const msgs = store.getPendingMessages("agent-b");
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.sender).toBe("agent-a");
      expect(msgs[0]!.receiver).toBe("agent-b");
    });

    it("messages are ordered by creation time", () => {
      store.queueMessage({ from: "s", to: "r", content: "first" });
      store.queueMessage({ from: "s", to: "r", content: "second" });
      store.queueMessage({ from: "s", to: "r", content: "third" });

      const msgs = store.getPendingMessages("r");
      expect(msgs[0]!.content).toBe("first");
      expect(msgs[1]!.content).toBe("second");
      expect(msgs[2]!.content).toBe("third");
    });

    it("messages for different receivers are independent", () => {
      store.queueMessage({ from: "s", to: "r1", content: "for r1" });
      store.queueMessage({ from: "s", to: "r2", content: "for r2" });

      expect(store.getPendingMessages("r1")).toHaveLength(1);
      expect(store.getPendingMessages("r2")).toHaveLength(1);
      expect(store.getPendingMessages("r1")[0]!.content).toBe("for r1");
      expect(store.getPendingMessages("r2")[0]!.content).toBe("for r2");
    });

    it("auto-increments message IDs", () => {
      const id1 = store.queueMessage({ from: "s", to: "r", content: "a" });
      const id2 = store.queueMessage({ from: "s", to: "r", content: "b" });
      const id3 = store.queueMessage({ from: "s", to: "r", content: "c" });

      expect(id2).toBeGreaterThan(id1);
      expect(id3).toBeGreaterThan(id2);
    });
  });

  // ── Session Cleanup ───────────────────────────────────────────────────

  describe("Session cleanup", () => {
    it("deletes all terminals for a session", () => {
      store.createTerminal({
        id: "t100",
        sessionId: "cleanup-session",
        provider: "claude-code",
        status: "idle",
        createdAt: new Date(),
      });
      store.createTerminal({
        id: "t101",
        sessionId: "cleanup-session",
        provider: "codex",
        status: "idle",
        createdAt: new Date(),
      });

      store.deleteSession("cleanup-session");

      const terminals = store.listTerminals("cleanup-session");
      expect(terminals).toHaveLength(0);
    });

    it("deletes inbox messages associated with session terminals", () => {
      store.createTerminal({
        id: "t200",
        sessionId: "inbox-session",
        provider: "claude-code",
        status: "idle",
        createdAt: new Date(),
      });

      // Messages where t200 is sender or receiver
      store.queueMessage({ from: "t200", to: "external", content: "outgoing" });
      store.queueMessage({ from: "external", to: "t200", content: "incoming" });

      store.deleteSession("inbox-session");

      expect(store.getAllMessages("t200")).toHaveLength(0);
      // The outgoing message to "external" should also be deleted
      // because the sender "t200" was part of the session
      const externalMsgs = store.getAllMessages("external");
      expect(externalMsgs).toHaveLength(0);
    });

    it("does not affect terminals from other sessions", () => {
      store.createTerminal({
        id: "t300",
        sessionId: "keep-session",
        provider: "claude-code",
        status: "idle",
        createdAt: new Date(),
      });
      store.createTerminal({
        id: "t301",
        sessionId: "delete-session",
        provider: "codex",
        status: "idle",
        createdAt: new Date(),
      });

      store.deleteSession("delete-session");

      expect(store.listTerminals("keep-session")).toHaveLength(1);
      expect(store.listTerminals("delete-session")).toHaveLength(0);
    });

    it("handles deletion of session with no terminals", () => {
      expect(() => store.deleteSession("empty-session")).not.toThrow();
    });
  });

  // ── Database Connection ───────────────────────────────────────────────

  describe("Database connection", () => {
    it("close can be called", () => {
      expect(() => store.close()).not.toThrow();
    });

    it("operations fail after close", () => {
      store.close();
      expect(() => store.listTerminals("s1")).toThrow();
    });
  });
});
