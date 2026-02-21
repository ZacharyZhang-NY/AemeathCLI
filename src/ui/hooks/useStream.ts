/**
 * Streaming response hook per PRD section 6.2
 * Handles real-time token-by-token output from AI models
 */

import { useState, useCallback, useRef } from "react";
import type { IStreamChunk, ITokenUsage } from "../../types/index.js";

interface IStreamState {
  readonly isStreaming: boolean;
  readonly content: string;
  readonly usage: ITokenUsage | undefined;
  readonly error: string | undefined;
  /** Human-readable label for the current activity (e.g. "Reading src/foo.ts"). */
  readonly activity: string | undefined;
}

interface IUseStreamReturn {
  readonly state: IStreamState;
  readonly startStream: (stream: AsyncIterable<IStreamChunk>) => Promise<void>;
  readonly cancelStream: () => void;
  readonly reset: () => void;
}

/** Format a tool call into a short human-readable activity label. */
function formatToolActivity(toolCall: { name: string; arguments: Record<string, unknown> }): string {
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
      const pat = typeof args["pattern"] === "string" ? args["pattern"] : "";
      return `Searching files ${pat}`;
    }
    case "grep": {
      const pat = typeof args["pattern"] === "string" ? args["pattern"] : "";
      return `Searching for "${pat.length > 30 ? pat.slice(0, 30) + "..." : pat}"`;
    }
    case "bash": {
      const cmd = typeof args["command"] === "string" ? args["command"] : "";
      const short = cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
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
    usage: undefined,
    error: undefined,
    activity: undefined,
  });

  const cancelRef = useRef(false);

  const startStream = useCallback(async (stream: AsyncIterable<IStreamChunk>) => {
    cancelRef.current = false;
    setState({
      isStreaming: true,
      content: "",
      usage: undefined,
      error: undefined,
      activity: undefined,
    });

    try {
      for await (const chunk of stream) {
        if (cancelRef.current) {
          break;
        }

        switch (chunk.type) {
          case "text":
            if (chunk.content) {
              setState((prev) => ({
                ...prev,
                content: prev.content + chunk.content,
                // Clear activity once we get text back (model is responding)
                activity: undefined,
              }));
            }
            break;

          case "tool_call":
            if (chunk.toolCall) {
              setState((prev) => ({
                ...prev,
                activity: formatToolActivity(chunk.toolCall!),
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
            }));
            return;

          case "done":
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              usage: chunk.usage ?? prev.usage,
              activity: undefined,
            }));
            return;
        }
      }

      setState((prev) => ({ ...prev, isStreaming: false, activity: undefined }));
    } catch (error: unknown) {
      setState((prev) => ({
        ...prev,
        isStreaming: false,
        error: error instanceof Error ? error.message : String(error),
        activity: undefined,
      }));
    }
  }, []);

  const cancelStream = useCallback(() => {
    cancelRef.current = true;
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  const reset = useCallback(() => {
    cancelRef.current = true;
    setState({
      isStreaming: false,
      content: "",
      usage: undefined,
      error: undefined,
      activity: undefined,
    });
  }, []);

  return { state, startStream, cancelStream, reset };
}
