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
}

interface IUseStreamReturn {
  readonly state: IStreamState;
  readonly startStream: (stream: AsyncIterable<IStreamChunk>) => Promise<void>;
  readonly cancelStream: () => void;
  readonly reset: () => void;
}

export function useStream(): IUseStreamReturn {
  const [state, setState] = useState<IStreamState>({
    isStreaming: false,
    content: "",
    usage: undefined,
    error: undefined,
  });

  const cancelRef = useRef(false);

  const startStream = useCallback(async (stream: AsyncIterable<IStreamChunk>) => {
    cancelRef.current = false;
    setState({
      isStreaming: true,
      content: "",
      usage: undefined,
      error: undefined,
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
            }));
            return;

          case "done":
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              usage: chunk.usage ?? prev.usage,
            }));
            return;
        }
      }

      setState((prev) => ({ ...prev, isStreaming: false }));
    } catch (error: unknown) {
      setState((prev) => ({
        ...prev,
        isStreaming: false,
        error: error instanceof Error ? error.message : String(error),
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
    });
  }, []);

  return { state, startStream, cancelStream, reset };
}
