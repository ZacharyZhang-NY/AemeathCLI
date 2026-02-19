/**
 * Unified provider interface per PRD section 7.1
 * All AI providers implement IModelProvider for consistent access.
 */

import type {
  IChatRequest,
  IChatResponse,
  IStreamChunk,
} from "../types/message.js";
import type { IModelInfo } from "../types/model.js";

/**
 * Unified interface for all AI model providers.
 * Adapters for Claude, OpenAI, Gemini, Kimi, and Ollama all implement this.
 */
export interface IModelProvider {
  readonly name: string;
  readonly supportedModels: readonly string[];

  /** Send a non-streaming chat request. */
  chat(request: IChatRequest): Promise<IChatResponse>;

  /** Send a streaming chat request returning an async iterable of chunks. */
  stream(request: IChatRequest): AsyncIterable<IStreamChunk>;

  /** Estimate token count for text using the specified model's tokenizer. */
  countTokens(text: string, model: string): Promise<number>;

  /** Retrieve static model metadata. */
  getModelInfo(model: string): IModelInfo;

  /** Dynamically fetch available model IDs from the provider API. Optional. */
  listAvailableModels?(): Promise<readonly string[]>;
}

/**
 * Options for constructing a provider adapter.
 */
export interface IProviderOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}
