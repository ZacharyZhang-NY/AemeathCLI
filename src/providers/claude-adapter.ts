/**
 * Claude (Anthropic) adapter via Vercel AI SDK per PRD section 7.1
 * Supports Claude Opus 4.6, Sonnet 4.6, Haiku 4.5
 */

import { generateText, streamText, type CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { logger } from "../utils/logger.js";
import {
  AuthenticationError,
  RateLimitError,
  ModelNotFoundError,
} from "../types/errors.js";
import { SUPPORTED_MODELS } from "../types/model.js";
import type { IModelInfo, ProviderName } from "../types/model.js";
import type {
  IChatRequest,
  IChatResponse,
  IChatMessage,
  IStreamChunk,
  IToolCall,
  IToolDefinition,
  ITokenUsage,
} from "../types/message.js";
import type { IModelProvider, IProviderOptions } from "./types.js";

const PROVIDER_NAME: ProviderName = "anthropic";

const CLAUDE_MODELS: readonly string[] = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

const CHARS_PER_TOKEN_ESTIMATE = 4;

function mapRole(role: string): "user" | "assistant" | "system" | "tool" {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "system":
      return "system";
    case "tool":
      return "tool";
    default:
      return "user";
  }
}

function convertTools(
  tools: readonly IToolDefinition[] | undefined,
): Record<string, { description: string; parameters: Record<string, unknown> }> | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined;
  }

  const result: Record<string, { description: string; parameters: Record<string, unknown> }> = {};

  for (const tool of tools) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of tool.parameters) {
      const prop: Record<string, unknown> = {
        type: param.type,
        description: param.description,
      };
      if (param.enum !== undefined) {
        prop["enum"] = param.enum;
      }
      if (param.default !== undefined) {
        prop["default"] = param.default;
      }
      properties[param.name] = prop;
      if (param.required) {
        required.push(param.name);
      }
    }

    result[tool.name] = {
      description: tool.description,
      parameters: {
        type: "object",
        properties,
        required,
      },
    };
  }

  return result;
}

function buildMessages(
  messages: readonly IChatMessage[],
): CoreMessage[] {
  return messages.map((msg) => ({
    role: mapRole(msg.role),
    content: msg.content,
  })) as CoreMessage[];
}

function computeCost(modelInfo: IModelInfo, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * modelInfo.inputPricePerMToken +
    (outputTokens / 1_000_000) * modelInfo.outputPricePerMToken
  );
}

function classifyError(error: unknown, model: string): never {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    throw new AuthenticationError(PROVIDER_NAME, message);
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    const match = /(\d+)\s*s/i.exec(message);
    const retryMs = match?.[1] !== undefined ? parseInt(match[1], 10) * 1000 : 60_000;
    throw new RateLimitError(PROVIDER_NAME, retryMs);
  }
  if (lower.includes("model") && lower.includes("not found")) {
    throw new ModelNotFoundError(model);
  }

  throw error instanceof Error ? error : new Error(message);
}

export class ClaudeAdapter implements IModelProvider {
  readonly name = PROVIDER_NAME;
  readonly supportedModels = CLAUDE_MODELS;

  private readonly anthropic: ReturnType<typeof createAnthropic>;

  constructor(options?: IProviderOptions) {
    const apiKey = options?.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    this.anthropic = createAnthropic({
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(options?.baseUrl !== undefined ? { baseURL: options.baseUrl } : {}),
    });
  }

  async chat(request: IChatRequest): Promise<IChatResponse> {
    const modelInfo = this.getModelInfo(request.model);
    const messages = buildMessages(request.messages);
    const tools = convertTools(request.tools);

    try {
      const result = await generateText({
        model: this.anthropic(request.model),
        messages,
        ...(request.system !== undefined ? { system: request.system } : {}),
        tools: tools as Record<string, never>,
        maxTokens: request.maxTokens ?? modelInfo.maxOutputTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });

      const toolCalls = extractToolCalls(result);
      const inputTokens = result.usage?.promptTokens ?? 0;
      const outputTokens = result.usage?.completionTokens ?? 0;

      const usage: ITokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: computeCost(modelInfo, inputTokens, outputTokens),
      };

      const responseMessage: IChatMessage = {
        id: result.response?.id ?? crypto.randomUUID(),
        role: "assistant",
        content: result.text,
        model: request.model,
        provider: PROVIDER_NAME,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokenUsage: usage,
        createdAt: new Date(),
      };

      return {
        id: result.response?.id ?? crypto.randomUUID(),
        model: request.model,
        provider: PROVIDER_NAME,
        message: responseMessage,
        usage,
        finishReason: mapFinishReason(result.finishReason),
      };
    } catch (error: unknown) {
      classifyError(error, request.model);
    }
  }

  async *stream(request: IChatRequest): AsyncIterable<IStreamChunk> {
    const modelInfo = this.getModelInfo(request.model);
    const messages = buildMessages(request.messages);
    const tools = convertTools(request.tools);

    try {
      const result = streamText({
        model: this.anthropic(request.model),
        messages,
        ...(request.system !== undefined ? { system: request.system } : {}),
        tools: tools as Record<string, never>,
        maxTokens: request.maxTokens ?? modelInfo.maxOutputTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          yield { type: "text", content: part.textDelta };
        } else if (part.type === "tool-call") {
          const toolCall: IToolCall = {
            id: part.toolCallId,
            name: part.toolName,
            arguments: part.args as Record<string, unknown>,
          };
          yield { type: "tool_call", toolCall };
        } else if (part.type === "finish") {
          const inputTokens = part.usage?.promptTokens ?? 0;
          const outputTokens = part.usage?.completionTokens ?? 0;
          const usage: ITokenUsage = {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            costUsd: computeCost(modelInfo, inputTokens, outputTokens),
          };
          yield { type: "usage", usage };
        } else if (part.type === "error") {
          const errMsg = part.error instanceof Error ? part.error.message : String(part.error);
          yield { type: "error", error: errMsg };
        }
      }

      yield { type: "done" };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errMsg, model: request.model }, "Claude stream error");
      yield { type: "error", error: errMsg };
      yield { type: "done" };
    }
  }

  async countTokens(text: string, _model: string): Promise<number> {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  getModelInfo(model: string): IModelInfo {
    const info = SUPPORTED_MODELS[model];
    if (info === undefined || info.provider !== PROVIDER_NAME) {
      throw new ModelNotFoundError(model);
    }
    return info;
  }
}

function extractToolCalls(
  result: { toolCalls?: ReadonlyArray<{ toolCallId: string; toolName: string; args: unknown }> },
): IToolCall[] {
  if (result.toolCalls === undefined || result.toolCalls.length === 0) {
    return [];
  }
  return result.toolCalls.map((tc) => ({
    id: tc.toolCallId,
    name: tc.toolName,
    arguments: tc.args as Record<string, unknown>,
  }));
}

function mapFinishReason(
  reason: string | undefined,
): "stop" | "tool_calls" | "max_tokens" | "error" {
  switch (reason) {
    case "stop":
    case "end-turn":
      return "stop";
    case "tool-calls":
      return "tool_calls";
    case "length":
    case "max-tokens":
      return "max_tokens";
    default:
      return "stop";
  }
}
