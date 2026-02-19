/**
 * Kimi (Moonshot) adapter — custom HTTP per PRD section 7.1
 * Uses OpenAI-compatible API format via fetch().
 * Supports Kimi K2.5
 */

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

const PROVIDER_NAME: ProviderName = "kimi";
const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";

const KIMI_MODELS: readonly string[] = ["kimi-k2.5"] as const;
const CHARS_PER_TOKEN_ESTIMATE = 4;

interface OpenAIMessage { role: string; content: string }
interface OpenAITool { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
interface OpenAIToolCallRef { id: string; type: string; function: { name: string; arguments: string } }
interface OpenAIChoice {
  index: number;
  message: { role: string; content: string | null; tool_calls?: readonly OpenAIToolCallRef[] };
  finish_reason: string;
}
interface OpenAIUsage { prompt_tokens: number; completion_tokens: number; total_tokens: number }
interface OpenAIChatResponse { id: string; choices: OpenAIChoice[]; usage: OpenAIUsage }

function convertMessages(messages: readonly IChatMessage[]): OpenAIMessage[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

function convertTools(tools: readonly IToolDefinition[] | undefined): OpenAITool[] | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => {
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
      properties[param.name] = prop;
      if (param.required) {
        required.push(param.name);
      }
    }
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: { type: "object", properties, required },
      },
    };
  });
}

function computeCost(modelInfo: IModelInfo, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * modelInfo.inputPricePerMToken +
    (outputTokens / 1_000_000) * modelInfo.outputPricePerMToken
  );
}

async function handleResponseError(response: Response, model: string): Promise<never> {
  const body = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new AuthenticationError(PROVIDER_NAME, body);
  }
  if (response.status === 429) {
    const retryHeader = response.headers.get("retry-after");
    const retryMs = retryHeader !== null ? parseInt(retryHeader, 10) * 1000 : 60_000;
    throw new RateLimitError(PROVIDER_NAME, retryMs);
  }
  if (response.status === 404) {
    throw new ModelNotFoundError(model);
  }
  throw new Error(`Kimi API error (${response.status}): ${body}`);
}

export class KimiAdapter implements IModelProvider {
  readonly name = PROVIDER_NAME;
  readonly supportedModels = KIMI_MODELS;

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options?: IProviderOptions) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = options?.apiKey ?? process.env["MOONSHOT_API_KEY"] ?? "";
  }

  async chat(request: IChatRequest): Promise<IChatResponse> {
    const modelInfo = this.getModelInfo(request.model);
    const messages = convertMessages(request.messages);
    const tools = convertTools(request.tools);

    if (request.system !== undefined) {
      messages.unshift({ role: "system", content: request.system });
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? modelInfo.maxOutputTokens,
      stream: false,
    };
    if (request.temperature !== undefined) {
      body["temperature"] = request.temperature;
    }
    if (tools !== undefined) {
      body["tools"] = tools;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await handleResponseError(response, request.model);
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const choice = data.choices[0];
    if (choice === undefined) {
      throw new Error("Kimi API returned empty choices");
    }

    const toolCalls = extractToolCalls(choice);
    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;

    const usage: ITokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: computeCost(modelInfo, inputTokens, outputTokens),
    };

    const responseMessage: IChatMessage = {
      id: data.id,
      role: "assistant",
      content: choice.message.content ?? "",
      model: request.model,
      provider: PROVIDER_NAME,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokenUsage: usage,
      createdAt: new Date(),
    };

    return {
      id: data.id,
      model: request.model,
      provider: PROVIDER_NAME,
      message: responseMessage,
      usage,
      finishReason: mapFinishReason(choice.finish_reason),
    };
  }

  async *stream(request: IChatRequest): AsyncIterable<IStreamChunk> {
    const modelInfo = this.getModelInfo(request.model);
    const messages = convertMessages(request.messages);
    const tools = convertTools(request.tools);

    if (request.system !== undefined) {
      messages.unshift({ role: "system", content: request.system });
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? modelInfo.maxOutputTokens,
      stream: true,
    };
    if (request.temperature !== undefined) {
      body["temperature"] = request.temperature;
    }
    if (tools !== undefined) {
      body["tools"] = tools;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await handleResponseError(response, request.model);
    }

    if (response.body === null) {
      yield { type: "error", error: "Kimi API returned empty stream body" };
      yield { type: "done" };
      return;
    }

    try {
      yield* this.parseSSEStream(response.body, modelInfo);
      yield { type: "done" };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errMsg, model: request.model }, "Kimi stream error");
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

  async listAvailableModels(): Promise<readonly string[]> {
    if (!this.apiKey) return [...this.supportedModels];

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return [...this.supportedModels];

      const data = (await response.json()) as { data: Array<{ id: string }> };
      const models = data.data.map((m) => m.id).sort();
      return models.length > 0 ? models : [...this.supportedModels];
    } catch {
      return [...this.supportedModels];
    }
  }

  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
    modelInfo: IModelInfo,
  ): AsyncIterable<IStreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "" || trimmed === "data: [DONE]") {
            continue;
          }
          if (!trimmed.startsWith("data: ")) {
            continue;
          }

          const jsonStr = trimmed.slice(6);
          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
            usage?: OpenAIUsage;
          };

          try {
            parsed = JSON.parse(jsonStr) as typeof parsed;
          } catch {
            continue;
          }

          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content !== undefined && delta.content !== "") {
            yield { type: "text", content: delta.content };
          }

          if (delta?.tool_calls !== undefined) {
            for (const tc of delta.tool_calls) {
              if (tc.id !== undefined && tc.function?.name !== undefined) {
                let args: Record<string, unknown> = {};
                if (tc.function.arguments !== undefined) {
                  try {
                    args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
                  } catch {
                    args = {};
                  }
                }
                const toolCall: IToolCall = {
                  id: tc.id,
                  name: tc.function.name,
                  arguments: args,
                };
                yield { type: "tool_call", toolCall };
              }
            }
          }

          if (parsed.usage !== undefined) {
            const inTok = parsed.usage.prompt_tokens;
            const outTok = parsed.usage.completion_tokens;
            yield {
              type: "usage",
              usage: {
                inputTokens: inTok,
                outputTokens: outTok,
                totalTokens: inTok + outTok,
                costUsd: computeCost(modelInfo, inTok, outTok),
              },
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function extractToolCalls(choice: OpenAIChoice): IToolCall[] {
  if (choice.message.tool_calls === undefined || choice.message.tool_calls.length === 0) {
    return [];
  }
  return choice.message.tool_calls.map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    } catch {
      args = {};
    }
    return {
      id: tc.id,
      name: tc.function.name,
      arguments: args,
    };
  });
}

function mapFinishReason(
  reason: string,
): "stop" | "tool_calls" | "max_tokens" | "error" {
  switch (reason) {
    case "stop":
      return "stop";
    case "tool_calls":
      return "tool_calls";
    case "length":
      return "max_tokens";
    default:
      return "stop";
  }
}
