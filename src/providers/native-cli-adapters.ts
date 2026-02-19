/**
 * Native CLI-backed provider adapters.
 * Uses official provider CLIs in non-interactive mode when credentials come from native login.
 */

import { randomUUID } from "node:crypto";
import { execa } from "execa";
import {
  AuthenticationError,
  ModelNotFoundError,
} from "../types/errors.js";
import { SUPPORTED_MODELS } from "../types/model.js";
import { logger } from "../utils/logger.js";
import type { IModelInfo, ProviderName } from "../types/model.js";
import type {
  IChatMessage,
  IChatRequest,
  IChatResponse,
  IStreamChunk,
  ITokenUsage,
} from "../types/message.js";
import type { IModelProvider } from "./types.js";

interface ICLIResult {
  readonly text: string;
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly finishReason?: IChatResponse["finishReason"] | undefined;
}

const CHARS_PER_TOKEN_ESTIMATE = 4;
const DEFAULT_CLI_TIMEOUT_MS = 120_000;

function resolveCliTimeoutMs(): number {
  const raw = process.env["AEMEATHCLI_NATIVE_CLI_TIMEOUT_MS"];
  if (raw === undefined) {
    return DEFAULT_CLI_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CLI_TIMEOUT_MS;
  }

  return parsed;
}

const CLI_TIMEOUT_MS = resolveCliTimeoutMs();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toJsonLines(output: string): unknown[] {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith("{"));

  const parsed: unknown[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line) as unknown);
    } catch {
      // Ignore non-JSON lines
    }
  }
  return parsed;
}

function buildPrompt(request: IChatRequest): string {
  const latestUser = [...request.messages]
    .reverse()
    .find((message) => message.role === "user");
  const fallbackLast = request.messages.length > 0
    ? request.messages[request.messages.length - 1]
    : undefined;

  const latestPrompt = latestUser?.content ?? fallbackLast?.content ?? "";
  if (request.system !== undefined && request.system.length > 0) {
    return `${request.system}\n\n${latestPrompt}`.trim();
  }
  return latestPrompt;
}

function computeCost(modelInfo: IModelInfo, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * modelInfo.inputPricePerMToken +
    (outputTokens / 1_000_000) * modelInfo.outputPricePerMToken
  );
}

function classifyCliError(provider: ProviderName, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("login")
    || lower.includes("credential")
    || lower.includes("authentication")
    || lower.includes("unauthorized")
    || lower.includes("forbidden")
    || lower.includes("api key")
    || lower.includes("token")
  ) {
    return new AuthenticationError(provider, message);
  }

  return error instanceof Error ? error : new Error(message);
}

abstract class BaseNativeCLIAdapter implements IModelProvider {
  abstract readonly name: ProviderName;
  abstract readonly supportedModels: readonly string[];

  protected abstract runCLI(model: string, prompt: string): Promise<ICLIResult>;

  async chat(request: IChatRequest): Promise<IChatResponse> {
    const modelInfo = this.getModelInfo(request.model);
    const prompt = buildPrompt(request);

    try {
      const result = await this.runCLI(request.model, prompt);

      const inputTokens = result.inputTokens ?? Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
      const outputTokens = result.outputTokens ?? Math.ceil(result.text.length / CHARS_PER_TOKEN_ESTIMATE);

      const usage: ITokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: computeCost(modelInfo, inputTokens, outputTokens),
      };

      const responseMessage: IChatMessage = {
        id: randomUUID(),
        role: "assistant",
        content: result.text,
        model: request.model,
        provider: this.name,
        tokenUsage: usage,
        createdAt: new Date(),
      };

      return {
        id: randomUUID(),
        model: request.model,
        provider: this.name,
        message: responseMessage,
        usage,
        finishReason: result.finishReason ?? "stop",
      };
    } catch (error: unknown) {
      throw classifyCliError(this.name, error);
    }
  }

  async *stream(request: IChatRequest): AsyncIterable<IStreamChunk> {
    try {
      const response = await this.chat(request);
      if (response.message.content.length > 0) {
        yield { type: "text", content: response.message.content };
      }
      yield { type: "usage", usage: response.usage };
      yield { type: "done" };
    } catch (error: unknown) {
      yield {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      };
      yield { type: "done" };
    }
  }

  async countTokens(text: string, _model: string): Promise<number> {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  getModelInfo(model: string): IModelInfo {
    const info = SUPPORTED_MODELS[model];
    if (info === undefined || info.provider !== this.name) {
      throw new ModelNotFoundError(model);
    }
    return info;
  }

  async listAvailableModels(): Promise<readonly string[]> {
    return [...this.supportedModels];
  }
}

export class ClaudeNativeCLIAdapter extends BaseNativeCLIAdapter {
  readonly name: ProviderName = "anthropic";
  readonly supportedModels = [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
  ] as const;

  protected async runCLI(model: string, prompt: string): Promise<ICLIResult> {
    const { stdout } = await execa(
      "claude",
      ["-p", "--output-format", "json", "--model", model, prompt],
      {
        timeout: CLI_TIMEOUT_MS,
        stdin: "ignore",
        env: { ...process.env, NO_COLOR: "1" },
      },
    );

    const lines = toJsonLines(stdout);
    const lastJson = lines.length > 0 ? lines[lines.length - 1] : undefined;

    if (!isRecord(lastJson)) {
      throw new Error("Claude CLI returned no JSON result");
    }

    const text = asString(lastJson["result"]) ?? "";
    const usage = isRecord(lastJson["usage"]) ? lastJson["usage"] : undefined;
    const inputTokens = usage ? asNumber(usage["input_tokens"]) : undefined;
    const outputTokens = usage ? asNumber(usage["output_tokens"]) : undefined;

    return {
      text,
      inputTokens,
      outputTokens,
      finishReason: "stop",
    };
  }
}

export class CodexNativeCLIAdapter extends BaseNativeCLIAdapter {
  readonly name: ProviderName = "openai";
  readonly supportedModels = ["gpt-5.2", "gpt-5.2-mini", "o3"] as const;

  protected async runCLI(model: string, prompt: string): Promise<ICLIResult> {
    const { stdout } = await execa(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        "--model",
        model,
        prompt,
      ],
      {
        timeout: CLI_TIMEOUT_MS,
        stdin: "ignore",
        env: { ...process.env, NO_COLOR: "1" },
      },
    );

    const lines = toJsonLines(stdout);
    const textParts: string[] = [];
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    for (const line of lines) {
      if (!isRecord(line)) continue;
      const type = asString(line["type"]);

      if (type === "item.completed") {
        const item = isRecord(line["item"]) ? line["item"] : undefined;
        if (item && asString(item["type"]) === "agent_message") {
          const text = asString(item["text"]);
          if (text && text.length > 0) {
            textParts.push(text);
          }
        }
      }

      if (type === "turn.completed") {
        const usage = isRecord(line["usage"]) ? line["usage"] : undefined;
        if (usage) {
          inputTokens = asNumber(usage["input_tokens"]) ?? inputTokens;
          outputTokens = asNumber(usage["output_tokens"]) ?? outputTokens;
        }
      }
    }

    return {
      text: textParts.join("\n").trim(),
      inputTokens,
      outputTokens,
      finishReason: "stop",
    };
  }
}

export class GeminiNativeCLIAdapter extends BaseNativeCLIAdapter {
  readonly name: ProviderName = "google";
  readonly supportedModels = ["gemini-2.5-pro", "gemini-2.5-flash"] as const;

  protected async runCLI(model: string, prompt: string): Promise<ICLIResult> {
    const { stdout } = await execa(
      "gemini",
      [
        "-p",
        prompt,
        "--model",
        model,
        "--output-format",
        "stream-json",
        "--approval-mode",
        "yolo",
      ],
      {
        timeout: CLI_TIMEOUT_MS,
        stdin: "ignore",
        env: { ...process.env, NO_COLOR: "1" },
      },
    );

    const lines = toJsonLines(stdout);
    let text = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    for (const line of lines) {
      if (!isRecord(line)) continue;
      const type = asString(line["type"]);

      if (type === "message" && asString(line["role"]) === "assistant") {
        const content = asString(line["content"]);
        if (content !== undefined) {
          const delta = line["delta"] === true;
          text = delta ? `${text}${content}` : content;
        }
      }

      if (type === "result") {
        const stats = isRecord(line["stats"]) ? line["stats"] : undefined;
        if (stats) {
          inputTokens = asNumber(stats["input_tokens"]) ?? inputTokens;
          outputTokens = asNumber(stats["output_tokens"]) ?? outputTokens;
        }
      }
    }

    return {
      text: text.trim(),
      inputTokens,
      outputTokens,
      finishReason: "stop",
    };
  }
}

export class KimiNativeCLIAdapter extends BaseNativeCLIAdapter {
  readonly name: ProviderName = "kimi";
  readonly supportedModels = ["kimi-k2.5"] as const;

  protected async runCLI(_model: string, prompt: string): Promise<ICLIResult> {
    const { stdout } = await execa(
      "kimi",
      ["--print", "--output-format", "stream-json", "-p", prompt],
      {
        timeout: CLI_TIMEOUT_MS,
        stdin: "ignore",
        env: { ...process.env, NO_COLOR: "1" },
      },
    );

    const lines = toJsonLines(stdout);
    let text = "";

    for (const line of lines) {
      if (!isRecord(line)) continue;
      if (asString(line["role"]) !== "assistant") continue;

      const content = line["content"];
      if (!Array.isArray(content)) continue;

      const textParts: string[] = [];
      for (const part of content) {
        if (!isRecord(part)) continue;
        if (asString(part["type"]) === "text") {
          const piece = asString(part["text"]);
          if (piece) textParts.push(piece);
        }
      }

      if (textParts.length > 0) {
        text = textParts.join("");
      }
    }

    return {
      text: text.trim(),
      finishReason: "stop",
    };
  }
}

export function logNativeAdapterSelection(provider: ProviderName): void {
  logger.info({ provider }, "Using native CLI adapter");
}
