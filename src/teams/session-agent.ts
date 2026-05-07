import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { IAgentConfig, IAgentState } from "../types/index.js";

export type SessionAgentMessageCallback = (
  method: "agent.streamChunk" | "agent.taskUpdate",
  params: Record<string, unknown>,
) => void;

export class SessionAgent {
  private readonly listeners = new Set<SessionAgentMessageCallback>();
  private readonly state: IAgentState;
  private unsubscribe: (() => void) | undefined;

  constructor(
    public readonly config: IAgentConfig,
    private readonly session: AgentSession,
  ) {
    this.state = {
      config,
      status: "idle",
    };
  }

  start(): void {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.session.subscribe((event: AgentSessionEvent) => {
      this.handleEvent(event);
    });
  }

  stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.state.status = "shutdown";
    this.session.dispose();
    return Promise.resolve();
  }

  getState(): IAgentState {
    return {
      config: this.state.config,
      status: this.state.status,
      currentTaskId: this.state.currentTaskId,
      paneId: this.state.paneId,
    };
  }

  onMessage(callback: SessionAgentMessageCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  assignTask(taskId: string, subject: string, description: string): void {
    this.state.currentTaskId = taskId;
    this.state.status = "active";
    this.emit("agent.taskUpdate", {
      agentId: this.config.agentId,
      taskId,
      status: "in_progress",
      subject,
    });

    const prompt = `${subject}\n\n${description}`;
    void this.session.prompt(prompt).then(
      () => {
        this.state.status = "idle";
        this.emit("agent.taskUpdate", {
          agentId: this.config.agentId,
          taskId,
          status: "completed",
          subject,
        });
        this.state.currentTaskId = undefined;
      },
      (error: unknown) => {
        this.state.status = "error";
        const message = error instanceof Error ? error.message : String(error);
        this.emit("agent.streamChunk", {
          agentId: this.config.agentId,
          taskId,
          content: `\nError: ${message}\n`,
        });
        this.emit("agent.taskUpdate", {
          agentId: this.config.agentId,
          taskId,
          status: "completed",
          subject,
        });
        this.state.currentTaskId = undefined;
      },
    );
  }

  private handleEvent(event: AgentSessionEvent): void {
    if (!this.state.currentTaskId) {
      return;
    }

    if (event.type === "message_update") {
      const assistantEvent = event.assistantMessageEvent as unknown as Record<string, unknown>;
      if (assistantEvent["type"] === "text_delta" && typeof assistantEvent["delta"] === "string") {
        this.emit("agent.streamChunk", {
          agentId: this.config.agentId,
          taskId: this.state.currentTaskId,
          content: assistantEvent["delta"],
        });
      }
      return;
    }

    if (event.type === "tool_execution_start") {
      this.emit("agent.streamChunk", {
        agentId: this.config.agentId,
        taskId: this.state.currentTaskId,
        content: `\n⚙ ${event.toolName}\n`,
      });
    }
  }

  private emit(method: "agent.streamChunk" | "agent.taskUpdate", params: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      listener(method, params);
    }
  }
}
