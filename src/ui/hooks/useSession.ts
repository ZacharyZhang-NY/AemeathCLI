import { randomUUID } from "node:crypto";
import { useEffect, useMemo, useState } from "react";
import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { IChatMessage, IToolCall } from "../../types/index.js";
import type { ProviderName } from "../../types/model.js";

interface SessionViewState {
  messages: IChatMessage[];
  isProcessing: boolean;
  streamingContent: string;
  activity?: string | undefined;
  tokenCount: string;
  cost: string;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) {
        return [];
      }

      const record = part as Record<string, unknown>;
      if (record["type"] === "text" && typeof record["text"] === "string") {
        return [record["text"]];
      }
      if (record["type"] === "thinking" && typeof record["thinking"] === "string") {
        return [record["thinking"]];
      }
      return [];
    })
    .join("\n");
}

function extractToolCalls(content: unknown): IToolCall[] | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const calls = content.flatMap((part) => {
    if (typeof part !== "object" || part === null) {
      return [];
    }

    const record = part as Record<string, unknown>;
    if (record["type"] !== "toolCall") {
      return [];
    }

    return [
      {
        id: typeof record["id"] === "string" ? record["id"] : randomUUID(),
        name: typeof record["name"] === "string" ? record["name"] : "tool",
        arguments:
          typeof record["arguments"] === "object" && record["arguments"] !== null
            ? (record["arguments"] as Record<string, unknown>)
            : {},
      },
    ];
  });

  return calls.length > 0 ? calls : undefined;
}

function toChatMessages(session: AgentSession): IChatMessage[] {
  return session.agent.state.messages.map((message, index) => {
    const record = message as unknown as Record<string, unknown>;
    const role = record["role"];
    const timestamp = typeof record["timestamp"] === "number" ? new Date(record["timestamp"]) : new Date();

    if (role === "user") {
      return {
        id: `user-${index}-${timestamp.getTime()}`,
        role: "user",
        content: extractTextContent(record["content"]),
        createdAt: timestamp,
      } satisfies IChatMessage;
    }

    if (role === "assistant") {
      const usage = record["usage"] as Record<string, unknown> | undefined;
      return {
        id: `assistant-${index}-${timestamp.getTime()}`,
        role: "assistant",
        content: extractTextContent(record["content"]),
        toolCalls: extractToolCalls(record["content"]),
        model: typeof record["model"] === "string" ? record["model"] : undefined,
        provider: typeof record["provider"] === "string" ? (record["provider"] as ProviderName) : undefined,
        tokenUsage:
          usage
            ? {
                inputTokens: typeof usage["input"] === "number" ? usage["input"] : 0,
                outputTokens: typeof usage["output"] === "number" ? usage["output"] : 0,
                totalTokens: typeof usage["totalTokens"] === "number" ? usage["totalTokens"] : 0,
                costUsd:
                  typeof usage["cost"] === "object" && usage["cost"] !== null && typeof (usage["cost"] as Record<string, unknown>)["total"] === "number"
                    ? ((usage["cost"] as Record<string, unknown>)["total"] as number)
                    : 0,
              }
            : undefined,
        createdAt: timestamp,
      } satisfies IChatMessage;
    }

    if (role === "toolResult") {
      const toolName = typeof record["toolName"] === "string" ? record["toolName"] : "tool";
      const content = extractTextContent(record["content"]);
      const isError = record["isError"] === true;
      return {
        id: `tool-${index}-${timestamp.getTime()}`,
        role: "tool",
        content: isError ? `Error: ${content}` : content,
        toolCalls: [
          {
            id: typeof record["toolCallId"] === "string" ? record["toolCallId"] : `tool-call-${index}`,
            name: toolName,
            arguments: {},
          },
        ],
        createdAt: timestamp,
      } satisfies IChatMessage;
    }

    return {
      id: `system-${index}-${timestamp.getTime()}`,
      role: "system",
      content: extractTextContent(record["content"]),
      createdAt: timestamp,
    } satisfies IChatMessage;
  });
}

function formatStats(session: AgentSession) {
  const stats = session.getSessionStats();
  return {
    tokenCount: stats.tokens.total.toLocaleString(),
    cost: `$${stats.cost.toFixed(4)}`,
  };
}

export function useSession(session: AgentSession): SessionViewState {
  const [messages, setMessages] = useState<IChatMessage[]>(() => toChatMessages(session));
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [activity, setActivity] = useState<string | undefined>(undefined);
  const [statsVersion, setStatsVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "turn_start":
          setIsProcessing(true);
          setStreamingContent("");
          setActivity(undefined);
          break;
        case "message_update": {
          const assistantEvent = event.assistantMessageEvent as unknown as Record<string, unknown>;
          if (assistantEvent["type"] === "text_delta" && typeof assistantEvent["delta"] === "string") {
            setStreamingContent((previous) => previous + String(assistantEvent["delta"]));
          }
          setMessages(toChatMessages(session));
          break;
        }
        case "tool_execution_start":
          setActivity(`Running ${event.toolName}`);
          break;
        case "tool_execution_update":
          setActivity(`Running ${event.toolName}`);
          break;
        case "tool_execution_end":
          setActivity(undefined);
          setMessages(toChatMessages(session));
          break;
        case "turn_end":
          setIsProcessing(false);
          setStreamingContent("");
          setActivity(undefined);
          setMessages(toChatMessages(session));
          setStatsVersion((value) => value + 1);
          break;
        default:
          setMessages(toChatMessages(session));
          break;
      }
    });

    return unsubscribe;
  }, [session]);

  const stats = useMemo(() => formatStats(session), [session, statsVersion, messages.length]);

  return {
    messages,
    isProcessing,
    streamingContent,
    activity,
    tokenCount: stats.tokenCount,
    cost: stats.cost,
  };
}
