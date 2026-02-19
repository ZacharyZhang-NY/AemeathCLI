/**
 * Ollama adapter — custom HTTP for local models per PRD section 7.1
 * Uses OpenAI-compatible API format at localhost:11434.
 * Dynamic model listing from Ollama API.
 */

import { logger } from "../utils/logger.js";
import { ModelNotFoundError } from "../types/errors.js";
import { SUPPORTED_MODELS } from "../types/model.js";
import type { IModelInfo, ProviderName, ModelRole } from "../types/model.js";
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

const PROVIDER_NAME: ProviderName = "ollama";
const DEFAULT_BASE_URL = "http://localhost:11434";
const CHARS_PER_TOKEN_ESTIMATE = 4;

interface OllamaListResponse { models: Array<{ name: string; size: number }> }
interface OpenAIMessage { role: string; content: string }
interface OpenAITool { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
interface OllamaToolCallRef { id: string; type: string; function: { name: string; arguments: string } }
interface OllamaChoice {
  index: number;
  message: { role: string; content: string | null; tool_calls?: readonly OllamaToolCallRef[] };
  finish_reason: string;
}
interface OllamaUsage { prompt_tokens: number; completion_tokens: number; total_tokens: number }
interface OllamaChatResponse { id: string; choices: OllamaChoice[]; usage?: OllamaUsage }

function convertMessages(messages: readonly IChatMessage[]): OpenAIMessage[] {
  return messages.map((msg) => ({ role: msg.role, content: msg.content }));
}

function convertTools(tools: readonly IToolDefinition[] | undefined): OpenAITool[] | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const param of tool.parameters) {
      properties[param.name] = { type: param.type, description: param.description };
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

function makeOllamaModelInfo(modelName: string): IModelInfo {
  return {
    id: modelName,
    name: modelName,
    provider: PROVIDER_NAME,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["coding", "bugfix", "testing", "documentation"] as readonly ModelRole[],
  };
}

export class OllamaAdapter implements IModelProvider {
  readonly name = PROVIDER_NAME;

  private readonly baseUrl: string;
  private cachedModels: string[] | undefined;

  constructor(options?: IProviderOptions) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  }

  get supportedModels(): readonly string[] {
    return this.cachedModels ?? [];
  }

  /**
   * Refresh available models from Ollama API.
   * Call once during initialization.
   */
  async refreshModels(): Promise<readonly string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        logger.warn({ status: response.status }, "Failed to list Ollama models");
        this.cachedModels = [];
        return [];
      }
      const data = (await response.json()) as OllamaListResponse;
      this.cachedModels = data.models.map((m) => m.name);
      logger.debug({ models: this.cachedModels }, "Ollama models discovered");
      return this.cachedModels;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: errMsg }, "Ollama not reachable");
      this.cachedModels = [];
      return [];
    }
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
      stream: false,
    };
    if (request.maxTokens !== undefined) {
      body["max_tokens"] = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      body["temperature"] = request.temperature;
    }
    if (tools !== undefined) {
      body["tools"] = tools;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    const choice = data.choices[0];
    if (choice === undefined) {
      throw new Error("Ollama API returned empty choices");
    }

    const toolCalls = extractToolCalls(choice);
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    const usage: ITokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: 0,
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
      stream: true,
    };
    if (request.maxTokens !== undefined) {
      body["max_tokens"] = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      body["temperature"] = request.temperature;
    }
    if (tools !== undefined) {
      body["tools"] = tools;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      yield { type: "error", error: `Ollama API error (${response.status}): ${text}` };
      yield { type: "done" };
      return;
    }

    if (response.body === null) {
      yield { type: "error", error: "Ollama returned empty stream body" };
      yield { type: "done" };
      return;
    }

    try {
      yield* this.parseSSEStream(response.body, modelInfo);
      yield { type: "done" };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errMsg, model: request.model }, "Ollama stream error");
      yield { type: "error", error: errMsg };
      yield { type: "done" };
    }
  }

  async countTokens(text: string, _model: string): Promise<number> {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  getModelInfo(model: string): IModelInfo {
    const staticInfo = SUPPORTED_MODELS[model];
    if (staticInfo !== undefined && staticInfo.provider === PROVIDER_NAME) {
      return staticInfo;
    }
    if (this.cachedModels !== undefined && this.cachedModels.includes(model)) {
      return makeOllamaModelInfo(model);
    }
    return makeOllamaModelInfo(model);
  }

  async listAvailableModels(): Promise<readonly string[]> {
    const models = await this.refreshModels();
    return models;
  }

  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
    _modelInfo: IModelInfo,
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
            usage?: OllamaUsage;
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
                yield {
                  type: "tool_call",
                  toolCall: { id: tc.id, name: tc.function.name, arguments: args },
                };
              }
            }
          }

          if (parsed.usage !== undefined) {
            yield {
              type: "usage",
              usage: {
                inputTokens: parsed.usage.prompt_tokens,
                outputTokens: parsed.usage.completion_tokens,
                totalTokens: parsed.usage.total_tokens,
                costUsd: 0,
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

function extractToolCalls(choice: OllamaChoice): IToolCall[] {
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
    return { id: tc.id, name: tc.function.name, arguments: args };
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
