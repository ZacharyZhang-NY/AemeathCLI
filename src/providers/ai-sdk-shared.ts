import { jsonSchema, type ModelMessage } from "ai";
import type { IModelInfo, ITokenUsage } from "../types/model.js";
import type { IChatMessage, IToolCall, IToolDefinition } from "../types/message.js";

type AiSdkToolEntry = {
  readonly description: string;
  readonly inputSchema: ReturnType<typeof jsonSchema<Record<string, unknown>>>;
};

export type AiSdkToolSet = Record<string, AiSdkToolEntry>;

type FinishReason = "stop" | "tool_calls" | "max_tokens" | "error";

type FinishReasonAliases = {
  readonly stop?: readonly string[] | undefined;
  readonly maxTokens?: readonly string[] | undefined;
};

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return { value: input };
}

export function buildAiSdkTools(
  tools: readonly IToolDefinition[] | undefined,
): AiSdkToolSet | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined;
  }

  const result: AiSdkToolSet = {};

  for (const tool of tools) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of tool.parameters) {
      const property: Record<string, unknown> = {
        type: param.type,
        description: param.description,
      };

      if (param.enum !== undefined) {
        property["enum"] = param.enum;
      }
      if (param.default !== undefined) {
        property["default"] = param.default;
      }

      properties[param.name] = property;

      if (param.required) {
        required.push(param.name);
      }
    }

    const inputSchema = {
      type: "object",
      properties,
      required,
    } as Parameters<typeof jsonSchema<Record<string, unknown>>>[0];

    result[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema<Record<string, unknown>>(inputSchema),
    };
  }

  return result;
}

export function buildModelMessages(
  messages: readonly IChatMessage[],
  options?: {
    readonly mapRole?: ((role: IChatMessage["role"]) => ModelMessage["role"]) | undefined;
  },
): ModelMessage[] {
  const mapRole = options?.mapRole ?? ((role: IChatMessage["role"]) => role as ModelMessage["role"]);

  return messages.map((message) => {
    if (message.role === "assistant" && message.toolCalls !== undefined && message.toolCalls.length > 0) {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
      > = [];

      if (message.content.length > 0) {
        parts.push({ type: "text", text: message.content });
      }

      for (const toolCall of message.toolCalls) {
        parts.push({
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.arguments,
        });
      }

      return { role: "assistant" as const, content: parts };
    }

    if (message.role === "tool") {
      const firstToolCall = message.toolCalls?.[0];

      if (firstToolCall !== undefined) {
        return {
          role: "tool" as const,
          content: [{
            type: "tool-result" as const,
            toolCallId: firstToolCall.id,
            toolName: firstToolCall.name,
            output: {
              type: "text" as const,
              value: message.content,
            },
          }],
        };
      }
    }

    const mappedRole = mapRole(message.role);

    if (mappedRole === "assistant") {
      return {
        role: "assistant" as const,
        content: message.content,
      };
    }

    if (mappedRole === "system") {
      return {
        role: "system" as const,
        content: message.content,
      };
    }

    return {
      role: "user" as const,
      content: message.content,
    };
  });
}

export function extractAiSdkToolCalls(
  toolCalls: readonly { toolCallId: string; toolName: string; input: unknown }[] | undefined,
): IToolCall[] {
  if (toolCalls === undefined || toolCalls.length === 0) {
    return [];
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId,
    name: toolCall.toolName,
    arguments: normalizeToolInput(toolCall.input),
  }));
}

export function buildTokenUsage(
  modelInfo: IModelInfo,
  usage: {
    readonly inputTokens: number | undefined;
    readonly outputTokens: number | undefined;
    readonly totalTokens: number | undefined;
  },
): ITokenUsage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? (inputTokens + outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd: computeCost(modelInfo, inputTokens, outputTokens),
  };
}

export function mapAiSdkFinishReason(
  reason: string | undefined,
  aliases?: FinishReasonAliases,
): FinishReason {
  const stopAliases = new Set(aliases?.stop ?? []);
  const maxTokenAliases = new Set(aliases?.maxTokens ?? []);

  if (reason === "stop" || stopAliases.has(reason ?? "")) {
    return "stop";
  }

  if (reason === "tool-calls") {
    return "tool_calls";
  }

  if (reason === "length" || maxTokenAliases.has(reason ?? "")) {
    return "max_tokens";
  }

  return "stop";
}

function computeCost(modelInfo: IModelInfo, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * modelInfo.inputPricePerMToken +
    (outputTokens / 1_000_000) * modelInfo.outputPricePerMToken
  );
}
