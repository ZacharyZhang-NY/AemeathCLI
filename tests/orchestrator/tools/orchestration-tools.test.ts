/**
 * Tests for orchestration tools — handoff, assign, collect_results,
 * send_message, and list_workers.
 *
 * Uses fully mocked WorkerManager and ProfileLoader to test
 * tool behavior without real PTY sessions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOrchestrationTools } from "../../../src/orchestrator/tools/orchestration-tools.js";
import type { WorkerManager } from "../../../src/orchestrator/worker-manager.js";
import type { ProfileLoader } from "../../../src/orchestrator/profiles/profile-loader.js";
import type { StateStore } from "../../../src/orchestrator/state-store.js";
import type { IToolRegistration } from "../../../src/types/tool.js";

// ── Mock Factories ──────────────────────────────────────────────────────

function createMockStateStore(): {
  listTerminals: ReturnType<typeof vi.fn>;
  queueMessage: ReturnType<typeof vi.fn>;
  getPendingMessages: ReturnType<typeof vi.fn>;
  markDelivered: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
} {
  return {
    listTerminals: vi.fn().mockReturnValue([]),
    queueMessage: vi.fn().mockReturnValue(42),
    getPendingMessages: vi.fn().mockReturnValue([]),
    markDelivered: vi.fn(),
    markFailed: vi.fn(),
  };
}

function createMockWorkerManager(stateOverride?: ReturnType<typeof createMockStateStore>): {
  mock: WorkerManager;
  spawnWorker: ReturnType<typeof vi.fn>;
  sendTask: ReturnType<typeof vi.fn>;
  waitForCompletion: ReturnType<typeof vi.fn>;
  extractResponse: ReturnType<typeof vi.fn>;
  destroyWorker: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  listWorkers: ReturnType<typeof vi.fn>;
  state: ReturnType<typeof createMockStateStore>;
  sessionId: string;
} {
  const state = stateOverride ?? createMockStateStore();
  const spawnWorker = vi.fn().mockResolvedValue({
    terminalId: "worker-001",
    provider: "claude-code",
    status: "idle",
  });
  const sendTask = vi.fn().mockResolvedValue(undefined);
  const waitForCompletion = vi.fn().mockResolvedValue(true);
  const extractResponse = vi.fn().mockResolvedValue("Worker output result");
  const destroyWorker = vi.fn().mockResolvedValue(undefined);
  const getStatus = vi.fn().mockReturnValue("idle");
  const listWorkers = vi.fn().mockReturnValue([]);

  const mock = {
    spawnWorker,
    sendTask,
    waitForCompletion,
    extractResponse,
    destroyWorker,
    getStatus,
    listWorkers,
    state,
    sessionId: "test-session",
  } as unknown as WorkerManager;

  return {
    mock,
    spawnWorker,
    sendTask,
    waitForCompletion,
    extractResponse,
    destroyWorker,
    getStatus,
    listWorkers,
    state,
    sessionId: "test-session",
  };
}

function createMockProfileLoader(): ProfileLoader {
  return {
    load: vi.fn().mockReturnValue({
      name: "developer",
      description: "Code implementation",
      systemPrompt: "You are a developer.",
    }),
    listProfiles: vi.fn().mockReturnValue([
      { name: "developer", description: "Code implementation", systemPrompt: "..." },
      { name: "reviewer", description: "Code review", systemPrompt: "..." },
    ]),
    resolveProvider: vi.fn().mockReturnValue("claude-code"),
    install: vi.fn().mockResolvedValue("developer"),
  } as unknown as ProfileLoader;
}

// ── Helper ──────────────────────────────────────────────────────────────

function getToolByName(
  tools: IToolRegistration[],
  name: string,
): IToolRegistration {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

function parseResult(result: { content: string; isError: boolean }): Record<string, unknown> {
  return JSON.parse(result.content) as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("createOrchestrationTools", () => {
  let wm: ReturnType<typeof createMockWorkerManager>;
  let pl: ProfileLoader;
  let tools: IToolRegistration[];

  beforeEach(() => {
    wm = createMockWorkerManager();
    pl = createMockProfileLoader();
    tools = createOrchestrationTools(wm.mock, pl, "claude-code");
  });

  it("creates exactly 5 tools", () => {
    expect(tools).toHaveLength(5);
  });

  it("creates all expected tool names", () => {
    const names = tools.map((t) => t.definition.name);
    expect(names).toContain("handoff");
    expect(names).toContain("assign");
    expect(names).toContain("collect_results");
    expect(names).toContain("send_message");
    expect(names).toContain("list_workers");
  });

  it("all tools have category shell", () => {
    for (const tool of tools) {
      expect(tool.category).toBe("shell");
    }
  });

  it("no tools require approval", () => {
    for (const tool of tools) {
      expect(tool.requiresApproval("strict", {})).toBe(false);
      expect(tool.requiresApproval("standard", {})).toBe(false);
      expect(tool.requiresApproval("permissive", {})).toBe(false);
    }
  });
});

describe("handoff tool", () => {
  let wm: ReturnType<typeof createMockWorkerManager>;
  let pl: ProfileLoader;
  let handoff: IToolRegistration;

  beforeEach(() => {
    wm = createMockWorkerManager();
    pl = createMockProfileLoader();
    const tools = createOrchestrationTools(wm.mock, pl, "claude-code");
    handoff = getToolByName(tools, "handoff");
  });

  it("has required parameters agent_profile and message", () => {
    const params = handoff.definition.parameters;
    const agentParam = params.find((p) => p.name === "agent_profile");
    const msgParam = params.find((p) => p.name === "message");
    expect(agentParam).toBeDefined();
    expect(agentParam!.required).toBe(true);
    expect(msgParam).toBeDefined();
    expect(msgParam!.required).toBe(true);
  });

  it("spawns worker, sends task, waits, extracts, and destroys", async () => {
    const result = await handoff.execute({
      agent_profile: "developer",
      message: "Build the feature",
    });

    expect(wm.spawnWorker).toHaveBeenCalledWith({
      agentProfile: "developer",
      provider: "claude-code",
    });
    expect(wm.sendTask).toHaveBeenCalledWith("worker-001", "Build the feature");
    expect(wm.waitForCompletion).toHaveBeenCalled();
    expect(wm.extractResponse).toHaveBeenCalledWith("worker-001");
    expect(wm.destroyWorker).toHaveBeenCalledWith("worker-001");

    const data = parseResult(result);
    expect(data["success"]).toBe(true);
    expect(data["output"]).toBe("Worker output result");
    expect(result.isError).toBe(false);
  });

  it("returns error when worker times out", async () => {
    wm.waitForCompletion.mockResolvedValue(false);

    const result = await handoff.execute({
      agent_profile: "developer",
      message: "Slow task",
      timeout_seconds: 30,
    });

    const data = parseResult(result);
    expect(data["success"]).toBe(false);
    expect(data["error"]).toContain("timed out");
    expect(result.isError).toBe(true);

    // Worker should still be destroyed on timeout
    expect(wm.destroyWorker).toHaveBeenCalled();
  });

  it("returns error when spawn fails", async () => {
    wm.spawnWorker.mockRejectedValue(new Error("Maximum workers reached"));

    const result = await handoff.execute({
      agent_profile: "developer",
      message: "Task",
    });

    const data = parseResult(result);
    expect(data["success"]).toBe(false);
    expect(data["error"]).toContain("Maximum workers reached");
    expect(result.isError).toBe(true);
  });

  it("uses profile loader to resolve provider", async () => {
    await handoff.execute({
      agent_profile: "developer",
      message: "Task",
    });

    expect(pl.resolveProvider).toHaveBeenCalledWith("developer", "claude-code");
  });

  it("uses explicit provider override when specified", async () => {
    await handoff.execute({
      agent_profile: "developer",
      message: "Task",
      provider: "codex",
    });

    expect(wm.spawnWorker).toHaveBeenCalledWith({
      agentProfile: "developer",
      provider: "codex",
    });
  });

  it("destroys worker even when extraction fails", async () => {
    wm.extractResponse.mockRejectedValue(new Error("Extraction failed"));

    const result = await handoff.execute({
      agent_profile: "developer",
      message: "Task",
    });

    expect(result.isError).toBe(true);
    expect(wm.destroyWorker).toHaveBeenCalled();
  });
});

describe("assign tool", () => {
  let wm: ReturnType<typeof createMockWorkerManager>;
  let pl: ProfileLoader;
  let assign: IToolRegistration;

  beforeEach(() => {
    wm = createMockWorkerManager();
    pl = createMockProfileLoader();
    const tools = createOrchestrationTools(wm.mock, pl, "claude-code");
    assign = getToolByName(tools, "assign");
  });

  it("spawns worker and sends task, returns terminal ID", async () => {
    const result = await assign.execute({
      agent_profile: "reviewer",
      message: "Review the code",
    });

    expect(wm.spawnWorker).toHaveBeenCalled();
    expect(wm.sendTask).toHaveBeenCalledWith("worker-001", "Review the code");

    const data = parseResult(result);
    expect(data["success"]).toBe(true);
    expect(data["terminalId"]).toBe("worker-001");
    expect(result.isError).toBe(false);
  });

  it("does NOT wait for completion", async () => {
    await assign.execute({
      agent_profile: "reviewer",
      message: "Review",
    });

    expect(wm.waitForCompletion).not.toHaveBeenCalled();
    expect(wm.extractResponse).not.toHaveBeenCalled();
    expect(wm.destroyWorker).not.toHaveBeenCalled();
  });

  it("returns error when spawn fails", async () => {
    wm.spawnWorker.mockRejectedValue(new Error("No room"));

    const result = await assign.execute({
      agent_profile: "reviewer",
      message: "Review",
    });

    const data = parseResult(result);
    expect(data["success"]).toBe(false);
    expect(data["error"]).toContain("No room");
    expect(result.isError).toBe(true);
  });

  it("uses explicit provider override", async () => {
    await assign.execute({
      agent_profile: "reviewer",
      message: "Review",
      provider: "gemini-cli",
    });

    expect(wm.spawnWorker).toHaveBeenCalledWith({
      agentProfile: "reviewer",
      provider: "gemini-cli",
    });
  });
});

describe("collect_results tool", () => {
  let wm: ReturnType<typeof createMockWorkerManager>;
  let collectResults: IToolRegistration;

  beforeEach(() => {
    wm = createMockWorkerManager();
    const pl = createMockProfileLoader();
    const tools = createOrchestrationTools(wm.mock, pl, "claude-code");
    collectResults = getToolByName(tools, "collect_results");
  });

  it("collects results from multiple workers", async () => {
    wm.waitForCompletion.mockResolvedValue(true);
    wm.extractResponse
      .mockResolvedValueOnce("Output A")
      .mockResolvedValueOnce("Output B");

    const result = await collectResults.execute({
      terminal_ids: "w1,w2",
    });

    const data = parseResult(result);
    const results = data["results"] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    expect(results[0]!["success"]).toBe(true);
    expect(results[1]!["success"]).toBe(true);
    expect(result.isError).toBe(false);
  });

  it("destroys workers after collection", async () => {
    await collectResults.execute({
      terminal_ids: "w1,w2",
    });

    expect(wm.destroyWorker).toHaveBeenCalledTimes(2);
  });

  it("handles timeout for individual workers", async () => {
    wm.waitForCompletion
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    wm.extractResponse.mockResolvedValueOnce("Success output");

    const result = await collectResults.execute({
      terminal_ids: "w1,w2",
      timeout_seconds: 10,
    });

    const data = parseResult(result);
    const results = data["results"] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);

    const succeeded = results.find((r) => r["success"] === true);
    const timedOut = results.find((r) => r["success"] === false);
    expect(succeeded).toBeDefined();
    expect(timedOut).toBeDefined();
    expect(timedOut!["error"]).toContain("Timed out");
  });

  it("handles comma-separated IDs with whitespace", async () => {
    wm.waitForCompletion.mockResolvedValue(true);

    await collectResults.execute({
      terminal_ids: " w1 , w2 , w3 ",
    });

    expect(wm.waitForCompletion).toHaveBeenCalledTimes(3);
  });

  it("filters out empty IDs from split", async () => {
    wm.waitForCompletion.mockResolvedValue(true);

    await collectResults.execute({
      terminal_ids: "w1,,w2,",
    });

    // Only w1 and w2 should be processed (empty strings filtered)
    expect(wm.waitForCompletion).toHaveBeenCalledTimes(2);
  });
});

describe("send_message tool", () => {
  let wm: ReturnType<typeof createMockWorkerManager>;
  let sendMessage: IToolRegistration;

  beforeEach(() => {
    wm = createMockWorkerManager();
    const pl = createMockProfileLoader();
    const tools = createOrchestrationTools(wm.mock, pl, "claude-code");
    sendMessage = getToolByName(tools, "send_message");
  });

  it("delivers immediately when worker is idle", async () => {
    wm.getStatus.mockReturnValue("idle");

    const result = await sendMessage.execute({
      terminal_id: "w1",
      message: "Additional context",
    });

    expect(wm.sendTask).toHaveBeenCalledWith("w1", "Additional context");
    const data = parseResult(result);
    expect(data["delivered"]).toBe(true);
    expect(result.isError).toBe(false);
  });

  it("delivers immediately when worker is completed", async () => {
    wm.getStatus.mockReturnValue("completed");

    const result = await sendMessage.execute({
      terminal_id: "w1",
      message: "Follow up",
    });

    expect(wm.sendTask).toHaveBeenCalled();
    const data = parseResult(result);
    expect(data["delivered"]).toBe(true);
  });

  it("queues message when worker is processing", async () => {
    wm.getStatus.mockReturnValue("processing");

    const result = await sendMessage.execute({
      terminal_id: "w1",
      message: "Queued message",
    });

    expect(wm.sendTask).not.toHaveBeenCalled();
    expect(wm.state.queueMessage).toHaveBeenCalledWith({
      from: "supervisor",
      to: "w1",
      content: "Queued message",
    });

    const data = parseResult(result);
    expect(data["queued"]).toBe(true);
    expect(data["messageId"]).toBe(42);
    expect(result.isError).toBe(false);
  });

  it("returns error when sendTask fails", async () => {
    wm.getStatus.mockReturnValue("idle");
    wm.sendTask.mockRejectedValue(new Error("Write failed"));

    const result = await sendMessage.execute({
      terminal_id: "w1",
      message: "Fail message",
    });

    const data = parseResult(result);
    expect(data["error"]).toContain("Write failed");
    expect(result.isError).toBe(true);
  });
});

describe("list_workers tool", () => {
  let wm: ReturnType<typeof createMockWorkerManager>;
  let listWorkers: IToolRegistration;

  beforeEach(() => {
    wm = createMockWorkerManager();
    const pl = createMockProfileLoader();
    const tools = createOrchestrationTools(wm.mock, pl, "claude-code");
    listWorkers = getToolByName(tools, "list_workers");
  });

  it("returns empty workers array when no terminals", async () => {
    wm.state.listTerminals.mockReturnValue([]);

    const result = await listWorkers.execute({});

    const data = parseResult(result);
    expect(data["workers"]).toEqual([]);
    expect(result.isError).toBe(false);
  });

  it("returns workers with status from provider", async () => {
    wm.state.listTerminals.mockReturnValue([
      {
        id: "t1",
        sessionId: "test-session",
        provider: "claude-code",
        agentProfile: "developer",
        status: "idle",
        createdAt: new Date(),
      },
      {
        id: "t2",
        sessionId: "test-session",
        provider: "codex",
        agentProfile: "reviewer",
        status: "processing",
        createdAt: new Date(),
      },
    ]);
    wm.getStatus
      .mockReturnValueOnce("idle")
      .mockReturnValueOnce("processing");

    const result = await listWorkers.execute({});

    const data = parseResult(result);
    const workers = data["workers"] as Array<Record<string, unknown>>;
    expect(workers).toHaveLength(2);
    expect(workers[0]!["terminalId"]).toBe("t1");
    expect(workers[0]!["agentProfile"]).toBe("developer");
    expect(workers[0]!["status"]).toBe("idle");
    expect(workers[1]!["terminalId"]).toBe("t2");
    expect(workers[1]!["status"]).toBe("processing");
  });

  it("has no required parameters", () => {
    const params = listWorkers.definition.parameters;
    expect(params).toHaveLength(0);
  });
});
