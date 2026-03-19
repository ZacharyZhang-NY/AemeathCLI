/**
 * OpenAI adapter via Vercel AI SDK per PRD section 7.1
 * Supports GPT-5.3 Codex, GPT-5.2, GPT-5.1 Codex series
 */

import { generateText, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
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

const PROVIDER_NAME: ProviderName = "openai";

const OPENAI_MODELS: readonly string[] = [
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.1-codex-mini",
] as const;

const CHARS_PER_TOKEN_ESTIMATE = 4;

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

export class OpenAIAdapter implements IModelProvider {
  readonly name = PROVIDER_NAME;
  readonly supportedModels = OPENAI_MODELS;
  readonly supportsToolCalling = true;

  private readonly openai: ReturnType<typeof createOpenAI>;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string | undefined;

  constructor(options?: IProviderOptions) {
    this.apiKey = options?.apiKey ?? process.env["OPENAI_API_KEY"];
    this.baseUrl = options?.baseUrl;
    this.openai = createOpenAI({
      ...(this.apiKey !== undefined ? { apiKey: this.apiKey } : {}),
      ...(this.baseUrl !== undefined ? { baseURL: this.baseUrl } : {}),
    });
  }

  async chat(request: IChatRequest): Promise<IChatResponse> {
    const modelInfo = this.getModelInfo(request.model);
    const messages = buildModelMessages(request.messages);
    const tools = buildAiSdkTools(request.tools);

    try {
      const result = await generateText({
        model: this.openai(request.model),
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
        model: this.openai(request.model),
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
      logger.error({ error: errMsg, model: request.model }, "OpenAI stream error");
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

  async listAvailableModels(): Promise<readonly string[]> {
    if (!this.apiKey) return [...this.supportedModels];

    try {
      const base = this.baseUrl ?? "https://api.openai.com/v1";
      const response = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [...this.supportedModels];

      const data = (await response.json()) as { data: Array<{ id: string }> };
      const chatPrefixes = ["gpt-", "o1", "o3", "o4", "chatgpt-"];
      const models = data.data
        .map((m) => m.id)
        .filter((id) => chatPrefixes.some((p) => id.startsWith(p)))
        .sort();
      return models.length > 0 ? models : [...this.supportedModels];
    } catch {
      return [...this.supportedModels];
    }
  }
}
