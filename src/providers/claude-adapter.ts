/**
 * Claude (Anthropic) adapter via Vercel AI SDK per PRD section 7.1
 * Supports Claude Opus 4.6, Sonnet 4.6, Haiku 4.5
 */

import { generateText, streamText } from "ai";
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
} from "../types/message.js";
import {
  buildAiSdkTools,
  buildModelMessages,
  buildTokenUsage,
  extractAiSdkToolCalls,
  mapAiSdkFinishReason,
} from "./ai-sdk-shared.js";
import type { IModelProvider, IProviderOptions } from "./types.js";

const PROVIDER_NAME: ProviderName = "anthropic";

const CLAUDE_MODELS: readonly string[] = [
  "claude-opus-4-6",
  "claude-opus-4-6-1m",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6-1m",
  "claude-haiku-4-5",
] as const;

const CHARS_PER_TOKEN_ESTIMATE = 4;

function mapRole(role: IChatMessage["role"]): "user" | "assistant" | "system" | "tool" {
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
  readonly supportsToolCalling = true;

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
    const messages = buildModelMessages(request.messages, { mapRole });
    const tools = buildAiSdkTools(request.tools);

    try {
      const result = await generateText({
        model: this.anthropic(request.model),
        messages,
        ...(request.system !== undefined ? { system: request.system } : {}),
        ...(tools !== undefined ? { tools } : {}),
        maxOutputTokens: request.maxTokens ?? modelInfo.maxOutputTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });

      const toolCalls = extractAiSdkToolCalls(result.toolCalls);
      const usage = buildTokenUsage(modelInfo, result.usage);

      const responseMessage: IChatMessage = {
        id: result.response.id,
        role: "assistant",
        content: result.text,
        model: request.model,
        provider: PROVIDER_NAME,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        tokenUsage: usage,
        createdAt: new Date(),
      };

      return {
        id: result.response.id,
        model: request.model,
        provider: PROVIDER_NAME,
        message: responseMessage,
        usage,
        finishReason: mapAiSdkFinishReason(result.finishReason, {
          stop: ["end-turn"],
          maxTokens: ["max-tokens"],
        }),
      };
    } catch (error: unknown) {
      classifyError(error, request.model);
    }
  }

  async *stream(request: IChatRequest): AsyncIterable<IStreamChunk> {
    const modelInfo = this.getModelInfo(request.model);
    const messages = buildModelMessages(request.messages, { mapRole });
    const tools = buildAiSdkTools(request.tools);

    try {
      const result = streamText({
        model: this.anthropic(request.model),
        messages,
        ...(request.system !== undefined ? { system: request.system } : {}),
        ...(tools !== undefined ? { tools } : {}),
        maxOutputTokens: request.maxTokens ?? modelInfo.maxOutputTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          yield { type: "text", content: part.text };
        } else if (part.type === "tool-call") {
          const [toolCall] = extractAiSdkToolCalls([{
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          }]);
          if (toolCall === undefined) {
            continue;
          }
          yield { type: "tool_call", toolCall };
        } else if (part.type === "finish") {
          const usage = buildTokenUsage(modelInfo, part.totalUsage);
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

  countTokens(text: string, _model: string): Promise<number> {
    return Promise.resolve(Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE));
  }

  getModelInfo(model: string): IModelInfo {
    const info = SUPPORTED_MODELS[model];
    if (info === undefined || info.provider !== PROVIDER_NAME) {
      throw new ModelNotFoundError(model);
    }
    return info;
  }
}
