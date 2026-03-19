/**
 * Tests for CLI provider status detection and response extraction.
 *
 * Each CLI provider implements detectStatus() and extractLastResponse()
 * to parse terminal output. These tests use fixture strings representing
 * typical terminal output for each provider.
 *
 * node-pty is NOT used — these tests operate on the pure string-parsing
 * methods of each provider class with a mock PtySessionManager.
 */

import { describe, it, expect } from "vitest";
import { ClaudeCodeCliProvider } from "../../../src/orchestrator/cli-providers/claude-code-cli-provider.js";
import { CodexCliProvider } from "../../../src/orchestrator/cli-providers/codex-cli-provider.js";
import { GeminiCliProvider } from "../../../src/orchestrator/cli-providers/gemini-cli-provider.js";
import { KimiCliProvider } from "../../../src/orchestrator/cli-providers/kimi-cli-provider.js";
import { OllamaCliProvider } from "../../../src/orchestrator/cli-providers/ollama-cli-provider.js";
import type { PtySessionManager } from "../../../src/orchestrator/pty/session-manager.js";

// ── Mock PtySessionManager ─────────────────────────────────────────────────
// Satisfies the type contract without using real PTY sessions.

function createMockSessionManager(): PtySessionManager {
  const mockSession = {
    id: "test-session",
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

const mockSM = createMockSessionManager();

// ── Claude Code ────────────────────────────────────────────────────────────

describe("ClaudeCodeCliProvider", () => {
  const provider = new ClaudeCodeCliProvider("test-id", mockSM);

  describe("properties", () => {
    it("has enterCount of 2", () => {
      expect(provider.enterCount).toBe(2);
    });

    it("has extractionRetries of 0", () => {
      expect(provider.extractionRetries).toBe(0);
    });

    it("returns correct start command", () => {
      expect(provider.getStartCommand()).toBe("claude --dangerously-skip-permissions");
    });

    it("returns correct exit command", () => {
      expect(provider.getExitCommand()).toBe("/exit");
    });

    it("returns correct idle pattern", () => {
      const pattern = provider.getIdlePattern();
      expect(pattern.test("> ")).toBe(true);
      expect(pattern.test("\u276F ")).toBe(true);
    });
  });

  describe("detectStatus", () => {
    it("detects idle state with prompt and no response marker", () => {
      const output = "Welcome to Claude Code\n> ";
      expect(provider.detectStatus(output)).toBe("idle");
    });

    it("detects idle state with unicode prompt", () => {
      const output = "Welcome to Claude Code\n\u276F ";
      expect(provider.detectStatus(output)).toBe("idle");
    });

    it("detects completed state with prompt and response marker", () => {
      const output = "Some text\n\u23FA Response content here\nMore text\n> ";
      expect(provider.detectStatus(output)).toBe("completed");
    });

    it("detects processing state when no prompt visible", () => {
      const output = "Working on something...\nAnalyzing files...";
      expect(provider.detectStatus(output)).toBe("processing");
    });

    it("detects waiting_user_answer when Allow appears", () => {
      const output = "Tool call: bash\nAllow this action? (y/n)";
      expect(provider.detectStatus(output)).toBe("waiting_user_answer");
    });

    it("detects waiting_user_answer when Deny appears", () => {
      const output = "Deny this action? Choose: Allow / Deny";
      expect(provider.detectStatus(output)).toBe("waiting_user_answer");
    });

    it("detects waiting_user_answer when approve appears (case insensitive)", () => {
      const output = "Do you approve this change?";
      expect(provider.detectStatus(output)).toBe("waiting_user_answer");
    });

    it("waiting_user_answer takes priority over completed", () => {
      const output = "\u23FA Some response\nAllow this action?\n> ";
      expect(provider.detectStatus(output)).toBe("waiting_user_answer");
    });

    it("only checks last 5 lines for prompt", () => {
      // Prompt is in line 1, but it is beyond the last 5 lines
      const lines = Array.from({ length: 10 }, (_, i) => `Line ${i}`);
      lines[0] = "> ";
      const output = lines.join("\n");
      expect(provider.detectStatus(output)).toBe("processing");
    });

    it("detects completed when prompt is in last 5 lines with marker", () => {
      const lines = [
        "Line 1",
        "\u23FA Response text",
        "Line 3",
        "Line 4",
        "> ",
      ];
      const output = lines.join("\n");
      expect(provider.detectStatus(output)).toBe("completed");
    });
  });

  describe("extractLastResponse", () => {
    it("extracts response after single marker", () => {
      const output = "Some prompt text\n\u23FA This is the response\n> ";
      const result = provider.extractLastResponse(output);
      expect(result).toBe("This is the response");
    });

    it("extracts last response when multiple markers present", () => {
      const output =
        "Prompt\n\u23FA First response\n\u23FA Second response\n> ";
      const result = provider.extractLastResponse(output);
      expect(result).toBe("Second response");
    });

    it("strips trailing prompt from response", () => {
      const output = "Prompt\n\u23FA The response content\n> next prompt";
      const result = provider.extractLastResponse(output);
      expect(result).toBe("The response content");
    });

    it("throws when no response marker found", () => {
      expect(() => provider.extractLastResponse("no marker here")).toThrow(
        "No response marker found",
      );
    });

    it("handles multiline response", () => {
      const output =
        "Prompt\n\u23FA Line one\nLine two\nLine three\n> ";
      const result = provider.extractLastResponse(output);
      expect(result).toContain("Line one");
      expect(result).toContain("Line two");
      expect(result).toContain("Line three");
    });
  });
});

// ── Codex ──────────────────────────────────────────────────────────────────

describe("CodexCliProvider", () => {
  const provider = new CodexCliProvider("test-id", mockSM);

  describe("properties", () => {
    it("has enterCount of 2", () => {
      expect(provider.enterCount).toBe(2);
    });

    it("has extractionRetries of 1", () => {
      expect(provider.extractionRetries).toBe(1);
    });

    it("returns correct start command", () => {
      expect(provider.getStartCommand()).toBe("codex --full-auto");
    });

    it("returns correct exit command", () => {
      expect(provider.getExitCommand()).toBe("Ctrl-C");
    });

    it("returns correct idle pattern", () => {
      const pattern = provider.getIdlePattern();
      expect(pattern.test("\u276F")).toBe(true);
      expect(pattern.test("\u203A")).toBe(true);
      expect(pattern.test("codex>")).toBe(true);
    });
  });

  describe("detectStatus", () => {
    it("detects idle state with prompt and no footer", () => {
      const output = "Welcome to Codex\n\u276F ";
      expect(provider.detectStatus(output)).toBe("idle");
    });

    it("detects completed state with prompt and cost footer", () => {
      const output =
        "Some output\nAssistant: Done!\nTokens: 1500\nCost: $0.02\n\u276F ";
      expect(provider.detectStatus(output)).toBe("completed");
    });

    it("detects completed with dollar sign in footer", () => {
      const output = "Response text\n$0.05 spent\ncodex>";
      expect(provider.detectStatus(output)).toBe("completed");
    });

    it("detects completed with tokens in footer", () => {
      const output = "Done\ntokens used: 2000\n\u203A ";
      expect(provider.detectStatus(output)).toBe("completed");
    });

    it("detects processing state when no prompt visible", () => {
      const output = "Generating code...\nPlease wait...";
      expect(provider.detectStatus(output)).toBe("processing");
    });

    it("only checks last 10 lines for prompt and footer", () => {
      const lines = Array.from({ length: 15 }, (_, i) => `Line ${i}`);
      lines[0] = "\u276F ";
      const output = lines.join("\n");
      // Prompt at line 0 is beyond the last 10 lines
      expect(provider.detectStatus(output)).toBe("processing");
    });
  });

  describe("extractLastResponse", () => {
    it("extracts response after Assistant marker", () => {
      const output = "User: do something\nAssistant: Here is the result";
      const result = provider.extractLastResponse(output);
      expect(result).toContain("Assistant");
      expect(result).toContain("Here is the result");
    });

    it("extracts last assistant response when multiple present", () => {
      const output =
        "Assistant: First\nUser: more\nAssistant: Second response";
      const result = provider.extractLastResponse(output);
      expect(result).toContain("Second response");
    });

    it("truncates at cost footer", () => {
      const output =
        "User: task\nAssistant: The answer\nTokens: 500\nCost: $0.01";
      const result = provider.extractLastResponse(output);
      expect(result).toContain("The answer");
      expect(result).not.toContain("$0.01");
    });

    it("throws when no assistant response found", () => {
      expect(() => provider.extractLastResponse("no assistant here")).toThrow(
        "No assistant response found",
      );
    });
  });
});

// ── Gemini CLI ─────────────────────────────────────────────────────────────

describe("GeminiCliProvider", () => {
  const provider = new GeminiCliProvider("test-id", mockSM);

  describe("properties", () => {
    it("has enterCount of 1", () => {
      expect(provider.enterCount).toBe(1);
    });

    it("has extractionRetries of 2", () => {
      expect(provider.extractionRetries).toBe(2);
    });

    it("returns correct start command", () => {
      expect(provider.getStartCommand()).toBe("gemini");
    });

    it("returns correct exit command", () => {
      expect(provider.getExitCommand()).toBe("/quit");
    });

    it("returns correct idle pattern", () => {
      const pattern = provider.getIdlePattern();
      expect(pattern.test("* Type your message")).toBe(true);
      expect(pattern.test("\u25C6 Type your message")).toBe(true);
      expect(pattern.test("\u2726 Type your message")).toBe(true);
    });
  });

  describe("detectStatus", () => {
    it("detects idle state with prompt and no response marker", () => {
      const output = "Welcome\n* Type your message here";
      expect(provider.detectStatus(output)).toBe("idle");
    });

    it("detects completed state with prompt and response marker", () => {
      const output =
        "Initial\n\u2726 Here is the response\nDone\n\u25C6 Type your message";
      expect(provider.detectStatus(output)).toBe("completed");
    });

    it("detects processing state when no prompt in last 500 chars", () => {
      const output = "Generating response...\nPlease wait...";
      expect(provider.detectStatus(output)).toBe("processing");
    });

    it("checks last 500 chars for idle pattern", () => {
      // Place prompt within last 500 chars
      const padding = "x".repeat(100);
      const output = padding + "\n\u25C6 Type your message";
      expect(provider.detectStatus(output)).toBe("idle");
    });

    it("prompt beyond last 500 chars is not detected", () => {
      const padding = "x".repeat(600);
      const output = "\u25C6 Type your message\n" + padding;
      expect(provider.detectStatus(output)).toBe("processing");
    });
  });

  describe("extractLastResponse", () => {
    it("extracts response after marker", () => {
      const output =
        "User input\n\u2726 The gemini response text\n\u25C6 Type your message";
      const result = provider.extractLastResponse(output);
      expect(result).toBe("The gemini response text");
    });

    it("extracts last response when multiple markers present", () => {
      const output =
        "\u2726 First\n\u2726 Second response text\n* Type your message";
      const result = provider.extractLastResponse(output);
      expect(result).toBe("Second response text");
    });

    it("strips trailing Type your message prompt", () => {
      const output =
        "\u2726 Response here\n\u25C6 Type your message and press enter";
      const result = provider.extractLastResponse(output);
      expect(result).toBe("Response here");
    });

    it("throws when no response marker found", () => {
      expect(() => provider.extractLastResponse("no marker")).toThrow(
        "No Gemini response marker",
      );
    });
  });
});

// ── Kimi CLI ───────────────────────────────────────────────────────────────

describe("KimiCliProvider", () => {
  const provider = new KimiCliProvider("test-id", mockSM);

  describe("properties", () => {
    it("has enterCount of 2", () => {
      expect(provider.enterCount).toBe(2);
    });

    it("has extractionRetries of 0", () => {
      expect(provider.extractionRetries).toBe(0);
    });

    it("returns correct start command", () => {
      expect(provider.getStartCommand()).toBe("kimi");
    });

    it("returns correct exit command", () => {
      expect(provider.getExitCommand()).toBe("/exit");
    });

    it("returns correct idle pattern", () => {
      const pattern = provider.getIdlePattern();
      expect(pattern.test("> hello")).toBe(true);
      expect(pattern.test("> ")).toBe(true);
    });
  });

  describe("detectStatus", () => {
    it("detects idle state with prompt and short output", () => {
      const output = "> ";
      expect(provider.detectStatus(output)).toBe("idle");
    });

    it("detects completed state with prompt and substantial output", () => {
      // output.length > 100 with prompt in last 300 chars
      const substantialOutput = "x".repeat(101) + "\n> ";
      expect(provider.detectStatus(substantialOutput)).toBe("completed");
    });

    it("detects processing state when no prompt visible", () => {
      const output = "Generating response...\nWorking hard...";
      expect(provider.detectStatus(output)).toBe("processing");
    });

    it("checks last 300 chars for prompt", () => {
      const padding = "y".repeat(200);
      const output = padding + "\n> ";
      expect(provider.detectStatus(output)).toBe("completed");
    });

    it("prompt beyond last 300 chars is not detected", () => {
      const padding = "z".repeat(400);
      const output = "> \n" + padding;
      expect(provider.detectStatus(output)).toBe("processing");
    });
  });

  describe("extractLastResponse", () => {
    it("extracts content before the only prompt marker", () => {
      // When there is only one `> ` prompt, `end` is set to the prompt line index.
      // `start` stays -1, so slice(0, end) returns all lines before the prompt.
      const output = "Some initial text\nThe response content\n> ";
      const result = provider.extractLastResponse(output);
      expect(result).toContain("The response content");
    });

    it("extracts all lines before a single trailing prompt", () => {
      const output = "Line 1\nLine 2\nLine 3\n> ";
      const result = provider.extractLastResponse(output);
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 2");
      expect(result).toContain("Line 3");
    });

    it("returns content before the earliest prompt when multiple prompts exist", () => {
      // The algorithm scans backwards, repeatedly overwriting `end`
      // because `start` stays at -1. The final `end` is the earliest prompt.
      // Result is lines.slice(0, earliestPromptIndex).
      const output = "> query\nLine 1\n> ";
      const result = provider.extractLastResponse(output);
      // Both lines are prompts, so end gets set to 0, result is empty
      expect(result).toBe("");
    });

    it("handles output with content before first prompt", () => {
      const output = "Welcome to Kimi\nReady\n> ";
      const result = provider.extractLastResponse(output);
      expect(result).toContain("Welcome to Kimi");
      expect(result).toContain("Ready");
    });
  });
});

// ── Ollama ─────────────────────────────────────────────────────────────────

describe("OllamaCliProvider", () => {
  const provider = new OllamaCliProvider("test-id", mockSM, "mistral");

  describe("properties", () => {
    it("has enterCount of 1", () => {
      expect(provider.enterCount).toBe(1);
    });

    it("has extractionRetries of 0", () => {
      expect(provider.extractionRetries).toBe(0);
    });

    it("returns correct start command with specified model", () => {
      expect(provider.getStartCommand()).toBe("ollama run mistral");
    });

    it("returns correct start command with default model", () => {
      const defaultProvider = new OllamaCliProvider("test-id", mockSM);
      expect(defaultProvider.getStartCommand()).toBe("ollama run llama3");
    });

    it("returns correct exit command", () => {
      expect(provider.getExitCommand()).toBe("/bye");
    });

    it("returns correct idle pattern", () => {
      const pattern = provider.getIdlePattern();
      expect(pattern.test(">>> ")).toBe(true);
      expect(pattern.test(">>>")).toBe(true);
    });
  });

  describe("detectStatus", () => {
    it("detects idle state with prompt and short output", () => {
      const output = ">>> ";
      expect(provider.detectStatus(output)).toBe("idle");
    });

    it("detects completed state with prompt and substantial output", () => {
      const substantialOutput = "x".repeat(51) + "\n>>> ";
      expect(provider.detectStatus(substantialOutput)).toBe("completed");
    });

    it("detects processing state when no prompt visible", () => {
      const output = "Generating tokens...\nProcessing query...";
      expect(provider.detectStatus(output)).toBe("processing");
    });

    it("checks last 200 chars for prompt", () => {
      const padding = "a".repeat(100);
      const output = padding + "\n>>> ";
      expect(provider.detectStatus(output)).toBe("completed");
    });

    it("prompt beyond last 200 chars is not detected", () => {
      const padding = "b".repeat(300);
      const output = ">>> \n" + padding;
      expect(provider.detectStatus(output)).toBe("processing");
    });
  });

  describe("extractLastResponse", () => {
    it("extracts response after prompt marker", () => {
      // Split on ^>>>\s* gives segments after each prompt marker.
      // ">>> hello\nThe model response here" splits to ["", "hello\nThe model response here"].
      // The last segment includes user input + response since they follow the same prompt.
      const output = ">>> hello\nThe model response here";
      const result = provider.extractLastResponse(output);
      expect(result).toBe("hello\nThe model response here");
    });

    it("extracts response with multiple prompt markers", () => {
      const output = ">>> first query\nFirst response\n>>> second query\nSecond response";
      const result = provider.extractLastResponse(output);
      expect(result).toContain("Second response");
    });

    it("throws when no prompt marker found", () => {
      expect(() => provider.extractLastResponse("no prompt here")).toThrow(
        "No Ollama response",
      );
    });

    it("handles single prompt marker with response", () => {
      const output = "Initial text\n>>> The response";
      const result = provider.extractLastResponse(output);
      expect(result).toBe("The response");
    });
  });
});
