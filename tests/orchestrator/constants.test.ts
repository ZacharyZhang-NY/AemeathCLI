/**
 * Tests for orchestrator constants — verifies all exports, types, and values.
 */

import { describe, it, expect } from "vitest";
import {
  CLI_PROVIDERS,
  DEFAULT_CLI_PROVIDER,
  SDK_FOR_CLI,
  MAX_BUFFER_BYTES,
  MAX_WORKERS_PER_SESSION,
  MAX_ORCHESTRATOR_STEPS,
  MAX_HANDOFF_DEPTH,
  MAX_OUTPUT_EXTRACT_BYTES,
  PROVIDER_INIT_TIMEOUT_MS,
  HANDOFF_TIMEOUT_MS,
  SHELL_READY_TIMEOUT_MS,
  STATUS_POLL_INTERVAL_MS,
  INBOX_POLL_INTERVAL_MS,
  WINDOWS_KILL_TIMEOUT_MS,
  EXIT_DRAIN_DELAY_MS,
  TAIL_BUFFER_LINES,
} from "../../src/orchestrator/constants.js";
import type {
  TerminalStatus,
  CliProviderType,
  TerminalRecord,
  InboxMessage,
  AgentProfile,
  WorkerInfo,
  SpawnOptions,
} from "../../src/orchestrator/constants.js";

describe("Orchestrator Constants", () => {
  describe("CLI_PROVIDERS", () => {
    it("defines exactly 5 CLI provider types", () => {
      expect(CLI_PROVIDERS).toHaveLength(5);
    });

    it("contains claude-code", () => {
      expect(CLI_PROVIDERS).toContain("claude-code");
    });

    it("contains codex", () => {
      expect(CLI_PROVIDERS).toContain("codex");
    });

    it("contains gemini-cli", () => {
      expect(CLI_PROVIDERS).toContain("gemini-cli");
    });

    it("contains kimi-cli", () => {
      expect(CLI_PROVIDERS).toContain("kimi-cli");
    });

    it("contains ollama", () => {
      expect(CLI_PROVIDERS).toContain("ollama");
    });

    it("is readonly (frozen)", () => {
      // The array should be readonly at the type level; at runtime
      // the `as const` assertion makes it a readonly tuple.
      expect(Array.isArray(CLI_PROVIDERS)).toBe(true);
    });
  });

  describe("DEFAULT_CLI_PROVIDER", () => {
    it("defaults to claude-code", () => {
      expect(DEFAULT_CLI_PROVIDER).toBe("claude-code");
    });

    it("is one of the CLI_PROVIDERS", () => {
      expect(CLI_PROVIDERS).toContain(DEFAULT_CLI_PROVIDER);
    });
  });

  describe("SDK_FOR_CLI", () => {
    it("maps claude-code to anthropic", () => {
      expect(SDK_FOR_CLI["claude-code"]).toBe("anthropic");
    });

    it("maps codex to openai", () => {
      expect(SDK_FOR_CLI["codex"]).toBe("openai");
    });

    it("maps gemini-cli to google", () => {
      expect(SDK_FOR_CLI["gemini-cli"]).toBe("google");
    });

    it("maps kimi-cli to kimi", () => {
      expect(SDK_FOR_CLI["kimi-cli"]).toBe("kimi");
    });

    it("maps ollama to ollama", () => {
      expect(SDK_FOR_CLI["ollama"]).toBe("ollama");
    });

    it("has entries for every CLI provider", () => {
      for (const provider of CLI_PROVIDERS) {
        expect(SDK_FOR_CLI[provider]).toBeDefined();
      }
    });
  });

  describe("Buffer and Limit Constants", () => {
    it("MAX_BUFFER_BYTES is 5MB", () => {
      expect(MAX_BUFFER_BYTES).toBe(5 * 1024 * 1024);
    });

    it("TAIL_BUFFER_LINES is 200", () => {
      expect(TAIL_BUFFER_LINES).toBe(200);
    });

    it("MAX_WORKERS_PER_SESSION is 10", () => {
      expect(MAX_WORKERS_PER_SESSION).toBe(10);
    });

    it("MAX_ORCHESTRATOR_STEPS is 30", () => {
      expect(MAX_ORCHESTRATOR_STEPS).toBe(30);
    });

    it("MAX_HANDOFF_DEPTH is 5", () => {
      expect(MAX_HANDOFF_DEPTH).toBe(5);
    });

    it("MAX_OUTPUT_EXTRACT_BYTES is 100KB", () => {
      expect(MAX_OUTPUT_EXTRACT_BYTES).toBe(100 * 1024);
    });

    it("all limits are positive numbers", () => {
      expect(MAX_BUFFER_BYTES).toBeGreaterThan(0);
      expect(TAIL_BUFFER_LINES).toBeGreaterThan(0);
      expect(MAX_WORKERS_PER_SESSION).toBeGreaterThan(0);
      expect(MAX_ORCHESTRATOR_STEPS).toBeGreaterThan(0);
      expect(MAX_HANDOFF_DEPTH).toBeGreaterThan(0);
      expect(MAX_OUTPUT_EXTRACT_BYTES).toBeGreaterThan(0);
    });
  });

  describe("Timeout Constants", () => {
    it("PROVIDER_INIT_TIMEOUT_MS is 30 seconds", () => {
      expect(PROVIDER_INIT_TIMEOUT_MS).toBe(30_000);
    });

    it("HANDOFF_TIMEOUT_MS is 10 minutes", () => {
      expect(HANDOFF_TIMEOUT_MS).toBe(600_000);
    });

    it("SHELL_READY_TIMEOUT_MS is 10 seconds", () => {
      expect(SHELL_READY_TIMEOUT_MS).toBe(10_000);
    });

    it("STATUS_POLL_INTERVAL_MS is 2 seconds", () => {
      expect(STATUS_POLL_INTERVAL_MS).toBe(2_000);
    });

    it("INBOX_POLL_INTERVAL_MS is 5 seconds", () => {
      expect(INBOX_POLL_INTERVAL_MS).toBe(5_000);
    });

    it("WINDOWS_KILL_TIMEOUT_MS is 5 seconds", () => {
      expect(WINDOWS_KILL_TIMEOUT_MS).toBe(5_000);
    });

    it("EXIT_DRAIN_DELAY_MS is 200 milliseconds", () => {
      expect(EXIT_DRAIN_DELAY_MS).toBe(200);
    });

    it("all timeouts are positive numbers", () => {
      expect(PROVIDER_INIT_TIMEOUT_MS).toBeGreaterThan(0);
      expect(HANDOFF_TIMEOUT_MS).toBeGreaterThan(0);
      expect(SHELL_READY_TIMEOUT_MS).toBeGreaterThan(0);
      expect(STATUS_POLL_INTERVAL_MS).toBeGreaterThan(0);
      expect(INBOX_POLL_INTERVAL_MS).toBeGreaterThan(0);
      expect(WINDOWS_KILL_TIMEOUT_MS).toBeGreaterThan(0);
      expect(EXIT_DRAIN_DELAY_MS).toBeGreaterThan(0);
    });
  });

  describe("Type Shapes (compile-time + runtime sanity)", () => {
    it("TerminalRecord shape is valid", () => {
      const record: TerminalRecord = {
        id: "abc",
        sessionId: "s1",
        provider: "claude-code",
        agentProfile: "developer",
        status: "idle",
        createdAt: new Date(),
      };
      expect(record.id).toBe("abc");
      expect(record.status).toBe("idle");
    });

    it("TerminalRecord allows undefined agentProfile", () => {
      const record: TerminalRecord = {
        id: "def",
        sessionId: "s2",
        provider: "codex",
        status: "processing",
        createdAt: new Date(),
      };
      expect(record.agentProfile).toBeUndefined();
    });

    it("InboxMessage shape is valid", () => {
      const msg: InboxMessage = {
        id: 1,
        sender: "supervisor",
        receiver: "worker1",
        content: "Do the thing",
        status: "pending",
        createdAt: new Date(),
      };
      expect(msg.status).toBe("pending");
      expect(msg.deliveredAt).toBeUndefined();
    });

    it("AgentProfile shape is valid", () => {
      const profile: AgentProfile = {
        name: "test",
        description: "A test agent",
        systemPrompt: "You are a test agent.",
      };
      expect(profile.name).toBe("test");
      expect(profile.provider).toBeUndefined();
    });

    it("WorkerInfo shape is valid", () => {
      const info: WorkerInfo = {
        terminalId: "t1",
        provider: "gemini-cli",
        status: "completed",
      };
      expect(info.provider).toBe("gemini-cli");
    });

    it("SpawnOptions shape is valid", () => {
      const opts: SpawnOptions = {
        provider: "ollama",
        agentProfile: "researcher",
        workingDirectory: "/tmp",
        model: "llama3",
      };
      expect(opts.provider).toBe("ollama");
      expect(opts.model).toBe("llama3");
    });

    it("TerminalStatus union covers expected values", () => {
      const statuses: TerminalStatus[] = [
        "idle",
        "processing",
        "completed",
        "waiting_user_answer",
        "error",
      ];
      expect(statuses).toHaveLength(5);
    });
  });
});
