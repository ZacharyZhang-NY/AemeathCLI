/**
 * Streaming response hook with tool-call state tracking.
 * Handles real-time token-by-token output from AI models
 * and provides structured tool execution state for UI rendering.
 *
 * Uses a newline-gated streaming controller to prevent mid-word
 * reflows — partial lines buffer until \n arrives.
 */

import { useState, useCallback, useRef } from "react";
import type { IStreamChunk, ITokenUsage } from "../../types/index.js";
import type { ToolStatus } from "../components/ToolCallDisplay.js";
import { createStreamingController, type StreamingController } from "../streaming-controller.js";

export interface IToolCallState {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: ToolStatus;
  readonly startTime: number;
  readonly endTime?: number;
}

interface IStreamState {
  readonly isStreaming: boolean;
  /** Committed (complete) lines — safe to render without reflow */
  readonly content: string;
  /** Partial line not yet terminated by \n — shown with pending style */
  readonly pendingLine: string;
  readonly usage: ITokenUsage | undefined;
  readonly error: string | undefined;
  readonly activity: string | undefined;
  /** Ordered list of tool calls with their current status. */
  readonly toolCalls: readonly IToolCallState[];
  /** Timestamp when streaming began. */
  readonly startTime: number | undefined;
  /** Whether the stream is paused (e.g. rate-limited) */
  readonly isPaused: boolean;
}

interface IUseStreamReturn {
  readonly state: IStreamState;
  readonly startStream: (stream: AsyncIterable<IStreamChunk>) => Promise<void>;
  readonly cancelStream: () => void;
  readonly reset: () => void;
}

/** Format a tool call into a short human-readable activity label. */
function formatToolActivity(toolCall: {
  name: string;
  arguments: Record<string, unknown>;
}): string {
  const args = toolCall.arguments;
  switch (toolCall.name) {
    case "read": {
      const fp = typeof args["file_path"] === "string" ? args["file_path"] : "";
      const short = fp.split("/").slice(-2).join("/");
      return `Reading ${short || "file"}`;
    }
    case "write": {
      const fp = typeof args["file_path"] === "string" ? args["file_path"] : "";
      const short = fp.split("/").slice(-2).join("/");
      return `Writing ${short || "file"}`;
    }
    case "edit": {
      const fp = typeof args["file_path"] === "string" ? args["file_path"] : "";
      const short = fp.split("/").slice(-2).join("/");
      return `Editing ${short || "file"}`;
    }
    case "glob": {
      const pat =
        typeof args["pattern"] === "string" ? args["pattern"] : "";
      return `Searching files ${pat}`;
    }
    case "grep": {
      const pat =
        typeof args["pattern"] === "string" ? args["pattern"] : "";
      return `Searching for "${pat.length > 30 ? pat.slice(0, 30) + "\u2026" : pat}"`;
    }
    case "bash": {
      const cmd =
        typeof args["command"] === "string" ? args["command"] : "";
      const short = cmd.length > 40 ? cmd.slice(0, 40) + "\u2026" : cmd;
      return `Running ${short}`;
    }
    case "web_search":
    case "webSearch":
      return "Searching the web";
    case "web_fetch":
    case "webFetch":
      return "Fetching URL";
    default:
      return `Calling ${toolCall.name}`;
  }
}

export function useStream(): IUseStreamReturn {
  const [state, setState] = useState<IStreamState>({
    isStreaming: false,
    content: "",
    pendingLine: "",
    usage: undefined,
    error: undefined,
    activity: undefined,
    toolCalls: [],
    startTime: undefined,
    isPaused: false,
  });

  const cancelRef = useRef(false);
  const streamingCtrlRef = useRef<StreamingController | null>(null);
  const isCancelled = (): boolean => cancelRef.current;

  const startStream = useCallback(
    async (stream: AsyncIterable<IStreamChunk>) => {
      cancelRef.current = false;
      const ctrl = createStreamingController();
      streamingCtrlRef.current = ctrl;
      setState({
        isStreaming: true,
        content: "",
        pendingLine: "",
        usage: undefined,
        error: undefined,
        activity: undefined,
        toolCalls: [],
        startTime: Date.now(),
        isPaused: false,
      });

      try {
        for await (const chunk of stream) {
          if (isCancelled()) break;

          switch (chunk.type) {
            case "text":
              if (chunk.content !== undefined) {
                const text = chunk.content;
                // Feed through newline-gated streaming controller
                ctrl.push(text);
                const ctrlState = ctrl.getState();
                setState((prev) => ({
                  ...prev,
                  content: ctrlState.committedLines.map((l) => l.text).join("\n"),
                  pendingLine: ctrlState.pendingLine,
                  activity: undefined,
                }));
              }
              break;

            case "tool_call":
              if (chunk.toolCall !== undefined) {
                const toolCall = chunk.toolCall;
                const desc = formatToolActivity(toolCall);
                const callState: IToolCallState = {
                  id:
                    toolCall.name +
                    "-" +
                    Date.now().toString(36),
                  name: toolCall.name,
                  description: desc,
                  status: "executing",
                  startTime: Date.now(),
                };
                setState((prev) => ({
                  ...prev,
                  activity: desc,
                  toolCalls: [
                    // Mark previous executing calls as success
                    ...prev.toolCalls.map((tc) =>
                      tc.status === "executing"
                        ? {
                            ...tc,
                            status: "success" as const,
                            endTime: Date.now(),
                          }
                        : tc,
                    ),
                    callState,
                  ],
                }));
              }
              break;

            case "usage":
              if (chunk.usage) {
                setState((prev) => ({
                  ...prev,
                  usage: chunk.usage,
                }));
              }
              break;

            case "error":
              setState((prev) => ({
                ...prev,
                error: chunk.error,
                isStreaming: false,
                activity: undefined,
                toolCalls: prev.toolCalls.map((tc) =>
                  tc.status === "executing"
                    ? {
                        ...tc,
                        status: "error" as const,
                        endTime: Date.now(),
                      }
                    : tc,
                ),
              }));
              return;

            case "done": {
              // Flush any remaining buffered content
              ctrl.flush();
              const finalState = ctrl.getState();
              setState((prev) => ({
                ...prev,
                isStreaming: false,
                content: finalState.committedLines.map((l) => l.text).join("\n"),
                pendingLine: "",
                usage: chunk.usage ?? prev.usage,
                activity: undefined,
                isPaused: false,
                toolCalls: prev.toolCalls.map((tc) =>
                  tc.status === "executing"
                    ? {
                        ...tc,
                        status: "success" as const,
                        endTime: Date.now(),
                      }
                    : tc,
                ),
              }));
              return;
            }
          }
        }

        // Stream ended without explicit "done" — flush remaining
        ctrl.flush();
        const endState = ctrl.getState();
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          content: endState.committedLines.map((l) => l.text).join("\n"),
          pendingLine: "",
          activity: undefined,
          isPaused: false,
          toolCalls: prev.toolCalls.map((tc) =>
            tc.status === "executing"
              ? {
                  ...tc,
                  status: "success" as const,
                  endTime: Date.now(),
                }
              : tc,
          ),
        }));
      } catch (error: unknown) {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: error instanceof Error ? error.message : String(error),
          activity: undefined,
          isPaused: false,
        }));
      }
    },
    [],
  );

  const cancelStream = useCallback(() => {
    cancelRef.current = true;
    // Flush remaining content before cancelling
    const ctrl = streamingCtrlRef.current;
    if (ctrl) {
      ctrl.flush();
      const finalState = ctrl.getState();
      setState((prev) => ({
        ...prev,
        isStreaming: false,
        content: finalState.committedLines.map((l) => l.text).join("\n"),
        pendingLine: "",
        isPaused: false,
        toolCalls: prev.toolCalls.map((tc) =>
          tc.status === "executing"
            ? {
                ...tc,
                status: "cancelled" as const,
                endTime: Date.now(),
              }
            : tc,
        ),
      }));
    } else {
      setState((prev) => ({
        ...prev,
        isStreaming: false,
        isPaused: false,
        toolCalls: prev.toolCalls.map((tc) =>
          tc.status === "executing"
            ? {
                ...tc,
                status: "cancelled" as const,
                endTime: Date.now(),
              }
            : tc,
        ),
      }));
    }
  }, []);

  const reset = useCallback(() => {
    cancelRef.current = true;
    streamingCtrlRef.current = null;
    setState({
      isStreaming: false,
      content: "",
      pendingLine: "",
      usage: undefined,
      error: undefined,
      activity: undefined,
      toolCalls: [],
      startTime: undefined,
      isPaused: false,
    });
  }, []);

  return { state, startStream, cancelStream, reset };
}
