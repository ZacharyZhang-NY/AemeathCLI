/**
 * Tests for CliProviderManager — factory and registry for CLI provider adapters.
 *
 * Verifies that the manager correctly instantiates provider subclasses,
 * stores them by terminal ID, and supports retrieval and removal.
 *
 * node-pty is NOT used — all tests use a mock PtySessionManager.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CliProviderManager } from "../../../src/orchestrator/cli-providers/cli-provider-manager.js";
import { ClaudeCodeCliProvider } from "../../../src/orchestrator/cli-providers/claude-code-cli-provider.js";
import { CodexCliProvider } from "../../../src/orchestrator/cli-providers/codex-cli-provider.js";
import { GeminiCliProvider } from "../../../src/orchestrator/cli-providers/gemini-cli-provider.js";
import { KimiCliProvider } from "../../../src/orchestrator/cli-providers/kimi-cli-provider.js";
import { OllamaCliProvider } from "../../../src/orchestrator/cli-providers/ollama-cli-provider.js";
import type { PtySessionManager } from "../../../src/orchestrator/pty/session-manager.js";

// ── Mock PtySessionManager ─────────────────────────────────────────────────

function createMockSessionManager(): PtySessionManager {
  const mockSession = {
    id: "mock-session",
    pty: {
      write: () => {},
      kill: () => {},
      pid: 0,
      cols: 200,
      rows: 50,
      process: "mock",
      handleFlowControl: false,
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      resize: () => {},
      pause: () => {},
      resume: () => {},
      clear: () => {},
    },
    buffer: "",
    tailLines: [] as string[],
    incompleteLine: "",
    provider: "claude-code" as const,
    agentProfile: "test",
    alive: true,
    recentWrites: [] as string[],
    createdAt: new Date(),
    disposables: [],
  };

  return {
    spawn: () => mockSession,
    write: () => {},
    writeLine: () => {},
    writeWithEnters: async () => {},
    getCleanTail: () => "",
    getFilteredOutput: () => "",
    clearBuffer: () => {},
    destroy: () => {},
    destroyAll: () => {},
    list: () => [],
    getSession: () => mockSession,
    has: () => true,
    get size() {
      return 0;
    },
  } as unknown as PtySessionManager;
}

describe("CliProviderManager", () => {
  let manager: CliProviderManager;
  let mockSM: PtySessionManager;

  beforeEach(() => {
    manager = new CliProviderManager();
    mockSM = createMockSessionManager();
  });

  describe("create", () => {
    it("creates a ClaudeCodeCliProvider for claude-code type", () => {
      const provider = manager.create("claude-code", "t1", mockSM);
      expect(provider).toBeInstanceOf(ClaudeCodeCliProvider);
    });

    it("creates a CodexCliProvider for codex type", () => {
      const provider = manager.create("codex", "t2", mockSM);
      expect(provider).toBeInstanceOf(CodexCliProvider);
    });

    it("creates a GeminiCliProvider for gemini-cli type", () => {
      const provider = manager.create("gemini-cli", "t3", mockSM);
      expect(provider).toBeInstanceOf(GeminiCliProvider);
    });

    it("creates a KimiCliProvider for kimi-cli type", () => {
      const provider = manager.create("kimi-cli", "t4", mockSM);
      expect(provider).toBeInstanceOf(KimiCliProvider);
    });

    it("creates an OllamaCliProvider for ollama type", () => {
      const provider = manager.create("ollama", "t5", mockSM);
      expect(provider).toBeInstanceOf(OllamaCliProvider);
    });

    it("passes model parameter to OllamaCliProvider", () => {
      const provider = manager.create("ollama", "t6", mockSM, "codellama");
      expect(provider).toBeInstanceOf(OllamaCliProvider);
      expect(provider.getStartCommand()).toBe("ollama run codellama");
    });

    it("stores the created provider for later retrieval", () => {
      const created = manager.create("claude-code", "t7", mockSM);
      const retrieved = manager.get("t7");
      expect(retrieved).toBe(created);
    });
  });

  describe("get", () => {
    it("returns the provider for an existing terminal ID", () => {
      manager.create("codex", "t10", mockSM);
      const provider = manager.get("t10");
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(CodexCliProvider);
    });

    it("returns undefined for a non-existent terminal ID", () => {
      const provider = manager.get("nonexistent");
      expect(provider).toBeUndefined();
    });
  });

  describe("remove", () => {
    it("removes a provider by terminal ID", () => {
      manager.create("gemini-cli", "t20", mockSM);
      expect(manager.get("t20")).toBeDefined();

      manager.remove("t20");
      expect(manager.get("t20")).toBeUndefined();
    });

    it("does not throw when removing a non-existent ID", () => {
      expect(() => manager.remove("nonexistent")).not.toThrow();
    });
  });

  describe("multiple providers", () => {
    it("stores multiple providers independently", () => {
      manager.create("claude-code", "a1", mockSM);
      manager.create("codex", "a2", mockSM);
      manager.create("gemini-cli", "a3", mockSM);

      expect(manager.get("a1")).toBeInstanceOf(ClaudeCodeCliProvider);
      expect(manager.get("a2")).toBeInstanceOf(CodexCliProvider);
      expect(manager.get("a3")).toBeInstanceOf(GeminiCliProvider);
    });

    it("removing one provider does not affect others", () => {
      manager.create("claude-code", "b1", mockSM);
      manager.create("codex", "b2", mockSM);

      manager.remove("b1");

      expect(manager.get("b1")).toBeUndefined();
      expect(manager.get("b2")).toBeInstanceOf(CodexCliProvider);
    });

    it("overwrites provider when creating with same terminal ID", () => {
      manager.create("claude-code", "c1", mockSM);
      expect(manager.get("c1")).toBeInstanceOf(ClaudeCodeCliProvider);

      manager.create("codex", "c1", mockSM);
      expect(manager.get("c1")).toBeInstanceOf(CodexCliProvider);
    });
  });
});
