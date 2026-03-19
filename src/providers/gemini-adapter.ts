/**
 * Gemini (Google) adapter via Vercel AI SDK per PRD section 7.1
 * Supports Gemini 2.5 Pro, Gemini 2.5 Flash
 */

import { generateText, streamText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
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

const PROVIDER_NAME: ProviderName = "google";

const GEMINI_MODELS: readonly string[] = [
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

const CHARS_PER_TOKEN_ESTIMATE = 4;

function classifyError(error: unknown, model: string): never {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    throw new AuthenticationError(PROVIDER_NAME, message);
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("resource exhausted")) {
    const match = /(\d+)\s*s/i.exec(message);
    const retryMs = match?.[1] !== undefined ? parseInt(match[1], 10) * 1000 : 60_000;
    throw new RateLimitError(PROVIDER_NAME, retryMs);
  }
  if (lower.includes("model") && lower.includes("not found")) {
    throw new ModelNotFoundError(model);
  }
  throw error instanceof Error ? error : new Error(message);
}

export class GeminiAdapter implements IModelProvider {
  readonly name = PROVIDER_NAME;
  readonly supportedModels = GEMINI_MODELS;
  readonly supportsToolCalling = true;
  private readonly google: ReturnType<typeof createGoogleGenerativeAI>;

  constructor(options?: IProviderOptions) {
    const apiKey = options?.apiKey ?? process.env["GOOGLE_API_KEY"];
    this.google = createGoogleGenerativeAI({
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(options?.baseUrl !== undefined ? { baseURL: options.baseUrl } : {}),
    });
  }

  async chat(request: IChatRequest): Promise<IChatResponse> {
    const modelInfo = this.getModelInfo(request.model);
    const messages = buildModelMessages(request.messages);
    const tools = buildAiSdkTools(request.tools);
    try {
      const result = await generateText({
        model: this.google(request.model),
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
        finishReason: mapAiSdkFinishReason(result.finishReason),
      };
    } catch (error: unknown) {
      classifyError(error, request.model);
    }
  }

  async *stream(request: IChatRequest): AsyncIterable<IStreamChunk> {
    const modelInfo = this.getModelInfo(request.model);
    const messages = buildModelMessages(request.messages);
    const tools = buildAiSdkTools(request.tools);
    try {
      const result = streamText({
        model: this.google(request.model),
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
          yield {
            type: "usage",
            usage: buildTokenUsage(modelInfo, part.totalUsage),
          };
        } else if (part.type === "error") {
          const errMsg = part.error instanceof Error ? part.error.message : String(part.error);
          yield { type: "error", error: errMsg };
        }
      }
      yield { type: "done" };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errMsg, model: request.model }, "Gemini stream error");
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
