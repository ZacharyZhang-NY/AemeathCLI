/**
 * Tests for detectInstalledProviders — CLI tool detection utility.
 *
 * Since we cannot control which CLI tools are installed on the test
 * machine, these tests verify the function's behavior by mocking
 * child_process.spawnSync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

// We need to mock spawnSync before importing the module under test.
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

// Import after mock is set up
const { detectInstalledProviders } = await import(
  "../../src/orchestrator/utils/detect-providers.js"
);

const mockedSpawnSync = vi.mocked(spawnSync);

describe("detectInstalledProviders", () => {
  beforeEach(() => {
    mockedSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when no providers are installed", () => {
    mockedSpawnSync.mockReturnValue({
      status: 1,
      signal: null,
      output: [],
      pid: 0,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    } as SpawnSyncReturns<Buffer>);

    const result = detectInstalledProviders();
    expect(result).toHaveLength(0);
  });

  it("detects claude-code when claude --version succeeds", () => {
    mockedSpawnSync.mockImplementation((cmd: string) => {
      return {
        status: cmd === "claude" ? 0 : 1,
        signal: null,
        output: [],
        pid: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      } as SpawnSyncReturns<Buffer>;
    });

    const result = detectInstalledProviders();
    expect(result).toContain("claude-code");
  });

  it("detects codex when codex --version succeeds", () => {
    mockedSpawnSync.mockImplementation((cmd: string) => {
      return {
        status: cmd === "codex" ? 0 : 1,
        signal: null,
        output: [],
        pid: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      } as SpawnSyncReturns<Buffer>;
    });

    const result = detectInstalledProviders();
    expect(result).toContain("codex");
  });

  it("detects gemini-cli when gemini --version succeeds", () => {
    mockedSpawnSync.mockImplementation((cmd: string) => {
      return {
        status: cmd === "gemini" ? 0 : 1,
        signal: null,
        output: [],
        pid: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      } as SpawnSyncReturns<Buffer>;
    });

    const result = detectInstalledProviders();
    expect(result).toContain("gemini-cli");
  });

  it("detects kimi-cli when kimi --version succeeds", () => {
    mockedSpawnSync.mockImplementation((cmd: string) => {
      return {
        status: cmd === "kimi" ? 0 : 1,
        signal: null,
        output: [],
        pid: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      } as SpawnSyncReturns<Buffer>;
    });

    const result = detectInstalledProviders();
    expect(result).toContain("kimi-cli");
  });

  it("detects ollama when ollama --version succeeds", () => {
    mockedSpawnSync.mockImplementation((cmd: string) => {
      return {
        status: cmd === "ollama" ? 0 : 1,
        signal: null,
        output: [],
        pid: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      } as SpawnSyncReturns<Buffer>;
    });

    const result = detectInstalledProviders();
    expect(result).toContain("ollama");
  });

  it("detects multiple installed providers", () => {
    mockedSpawnSync.mockImplementation((cmd: string) => {
      const installed = ["claude", "ollama"];
      return {
        status: installed.includes(cmd as string) ? 0 : 1,
        signal: null,
        output: [],
        pid: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      } as SpawnSyncReturns<Buffer>;
    });

    const result = detectInstalledProviders();
    expect(result).toContain("claude-code");
    expect(result).toContain("ollama");
    expect(result).not.toContain("codex");
    expect(result).not.toContain("gemini-cli");
    expect(result).not.toContain("kimi-cli");
  });

  it("detects all providers when all are installed", () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      signal: null,
      output: [],
      pid: 0,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    } as SpawnSyncReturns<Buffer>);

    const result = detectInstalledProviders();
    expect(result).toHaveLength(5);
    expect(result).toContain("claude-code");
    expect(result).toContain("codex");
    expect(result).toContain("gemini-cli");
    expect(result).toContain("kimi-cli");
    expect(result).toContain("ollama");
  });

  it("handles exceptions from spawnSync gracefully", () => {
    mockedSpawnSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = detectInstalledProviders();
    expect(result).toHaveLength(0);
  });

  it("handles null status from spawnSync", () => {
    mockedSpawnSync.mockReturnValue({
      status: null,
      signal: "SIGTERM",
      output: [],
      pid: 0,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    } as SpawnSyncReturns<Buffer>);

    const result = detectInstalledProviders();
    expect(result).toHaveLength(0);
  });

  it("handles mixed success and failure", () => {
    let callCount = 0;
    mockedSpawnSync.mockImplementation(() => {
      callCount++;
      // Only the first call succeeds (claude)
      if (callCount === 1) {
        return {
          status: 0,
          signal: null,
          output: [],
          pid: 0,
          stdout: Buffer.from(""),
          stderr: Buffer.from(""),
        } as SpawnSyncReturns<Buffer>;
      }
      // Second call throws
      if (callCount === 2) {
        throw new Error("Command not found");
      }
      // Others fail with non-zero exit
      return {
        status: 127,
        signal: null,
        output: [],
        pid: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      } as SpawnSyncReturns<Buffer>;
    });

    const result = detectInstalledProviders();
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("claude-code");
  });

  it("returns an array type", () => {
    mockedSpawnSync.mockReturnValue({
      status: 1,
      signal: null,
      output: [],
      pid: 0,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    } as SpawnSyncReturns<Buffer>);

    const result = detectInstalledProviders();
    expect(Array.isArray(result)).toBe(true);
  });
});
