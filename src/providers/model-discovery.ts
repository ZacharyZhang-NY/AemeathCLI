/**
 * Runtime model discovery — reads real model lists from provider CLIs
 * and user config. Merges with the hardcoded fallback registry.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { execa } from "execa";
import { logger } from "../utils/logger.js";
import { getAemeathHome } from "../utils/pathResolver.js";
import {
  SUPPORTED_MODELS,
  PROVIDER_MODEL_ORDER,
  type IModelInfo,
  type IModelDisplayEntry,
  type ProviderName,
} from "../types/model.js";

// ── Cache ────────────────────────────────────────────────────────────────

let discoveryComplete = false;
const dynamicModels: Record<string, IModelInfo> = {};
const dynamicDisplayOrder: Record<string, IModelDisplayEntry[]> = {};

// ── Helper to create a model entry with defaults ────────────────────────

function makeModelInfo(
  id: string,
  name: string,
  provider: ProviderName,
  description?: string,
  contextWindow?: number,
): IModelInfo {
  return {
    id,
    name,
    provider,
    contextWindow: contextWindow ?? 200_000,
    maxOutputTokens: 16_384,
    inputPricePerMToken: 0,
    outputPricePerMToken: 0,
    supportsStreaming: true,
    supportsToolCalling: true,
    supportedRoles: ["coding"],
    description,
  };
}

// ── Codex (OpenAI) discovery ────────────────────────────────────────────

async function discoverCodexModels(): Promise<void> {
  // 1. Read user's current model from ~/.codex/config.toml
  const configPath = join(homedir(), ".codex", "config.toml");
  let currentModel: string | undefined;
  try {
    const raw = await readFile(configPath, "utf-8");
    const match = raw.match(/^model\s*=\s*"([^"]+)"/m);
    if (match?.[1]) {
      currentModel = match[1];
    }
  } catch {
    // No config file
  }

  // 2. Try to get the interactive model list via `codex model` (needs TTY, may fail)
  //    Fallback: run `codex exec --help` and extract model references
  try {
    const { stdout } = await execa("codex", ["exec", "--help"], {
      timeout: 5000,
      stdin: "ignore",
      env: { ...process.env, NO_COLOR: "1" },
    });
    // Extract model IDs from help text (e.g. model="o3")
    const modelRefs = stdout.matchAll(/model="([^"]+)"/g);
    for (const m of modelRefs) {
      const id = m[1];
      if (id && !SUPPORTED_MODELS[id] && !dynamicModels[id]) {
        addModel(id, id, "openai");
      }
    }
  } catch {
    // Codex not installed
  }

  // 3. If the user's current model isn't in our list, add it
  if (currentModel && !SUPPORTED_MODELS[currentModel] && !dynamicModels[currentModel]) {
    addModel(currentModel, currentModel, "openai", `User's current Codex model`);
  }

  // 4. Probe for known recent Codex models that may not be in our hardcoded list
  const knownCodexModels = [
    { id: "gpt-5.4", name: "GPT-5.4", desc: "Latest frontier agentic coding model" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", desc: "Smaller frontier agentic coding model" },
    { id: "o3", name: "o3", desc: "OpenAI o3 reasoning model" },
    { id: "o4-mini", name: "o4-mini", desc: "OpenAI o4-mini reasoning model" },
  ];
  for (const m of knownCodexModels) {
    if (!SUPPORTED_MODELS[m.id] && !dynamicModels[m.id]) {
      addModel(m.id, m.name, "openai", m.desc);
    }
  }
}

// ── Gemini (Google) discovery ───────────────────────────────────────────

async function discoverGeminiModels(): Promise<void> {
  // 1. Read the Gemini CLI's models.js source for VALID_GEMINI_MODELS
  const geminiModelsPath = await findGeminiModelsFile();
  if (geminiModelsPath) {
    try {
      const source = await readFile(geminiModelsPath, "utf-8");

      // Extract model IDs from export const statements and Set entries
      const modelMatches = source.matchAll(/['"]([^'"]*gemini[^'"]+)['"]/g);
      for (const m of modelMatches) {
        const id = m[1];
        if (
          id &&
          !id.includes("embedding") &&
          !id.includes("auto-") &&
          !id.includes("customtools") &&
          !SUPPORTED_MODELS[id] &&
          !dynamicModels[id]
        ) {
          const name = id
            .replace(/-preview$/, " Preview")
            .replace(/-lite$/, " Lite")
            .split("-")
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(" ");
          addModel(id, name, "google", undefined, 2_000_000);
        }
      }
    } catch {
      logger.debug("Failed to read Gemini CLI models source");
    }
  }

  // 2. Fallback: probe known recent Gemini models
  const knownGeminiModels = [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", desc: "Latest Gemini Pro preview" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview", desc: "Latest Flash Lite preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview", desc: "Gemini 3 Flash preview" },
  ];
  for (const m of knownGeminiModels) {
    if (!SUPPORTED_MODELS[m.id] && !dynamicModels[m.id]) {
      addModel(m.id, m.name, "google", m.desc, 2_000_000);
    }
  }
}

/** Find the Gemini CLI's models.js file in node_modules. */
async function findGeminiModelsFile(): Promise<string | undefined> {
  // Try to find via which gemini → resolve symlink → find models.js
  try {
    const { stdout } = await execa("which", ["gemini"], {
      stdin: "ignore",
      timeout: 5_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const whichResult = stdout.trim();
    if (whichResult) {
      // gemini binary is at e.g. /Users/x/.nvm/versions/node/v22.18.0/bin/gemini
      // models.js is at .../lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/config/models.js
      const binDir = dirname(whichResult);
      const modelsPath = join(
        binDir,
        "..",
        "lib",
        "node_modules",
        "@google",
        "gemini-cli",
        "node_modules",
        "@google",
        "gemini-cli-core",
        "dist",
        "src",
        "config",
        "models.js",
      );
      if (existsSync(modelsPath)) {
        return modelsPath;
      }
    }
  } catch {
    // which not available or gemini not installed
  }

  return undefined;
}

// ── Claude (Anthropic) discovery ────────────────────────────────────────

async function discoverClaudeModels(): Promise<void> {
  // Claude models are well-known and change infrequently.
  // The hardcoded list is accurate. Just verify claude CLI exists.
  try {
    await execa("claude", ["--version"], {
      timeout: 5000,
      stdin: "ignore",
      env: { ...process.env, NO_COLOR: "1" },
    });
  } catch {
    logger.debug("Claude CLI not available");
  }
}

// ── User-defined models from ~/.aemeathcli/models.json ─────────────────

interface IUserModelEntry {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly description?: string;
  readonly contextWindow?: number;
}

async function loadUserModels(): Promise<void> {
  const modelsPath = join(getAemeathHome(), "models.json");
  try {
    const raw = await readFile(modelsPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;

    for (const entry of parsed) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as IUserModelEntry).id === "string" &&
        typeof (entry as IUserModelEntry).name === "string" &&
        typeof (entry as IUserModelEntry).provider === "string"
      ) {
        const e = entry as IUserModelEntry;
        addModel(
          e.id,
          e.name,
          e.provider as ProviderName,
          e.description,
          e.contextWindow,
        );
      }
    }
  } catch {
    // File doesn't exist or invalid
  }
}

// ── Internal helpers ────────────────────────────────────────────────────

function addModel(
  id: string,
  name: string,
  provider: ProviderName,
  description?: string,
  contextWindow?: number,
): void {
  dynamicModels[id] = makeModelInfo(id, name, provider, description, contextWindow);

  if (!dynamicDisplayOrder[provider]) {
    dynamicDisplayOrder[provider] = [];
  }
  if (!dynamicDisplayOrder[provider].some((e) => e.id === id)) {
    dynamicDisplayOrder[provider].push({
      id,
      label: name,
      description: description ?? "",
    });
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export async function discoverModels(): Promise<void> {
  if (discoveryComplete) return;

  await Promise.allSettled([
    loadUserModels(),
    discoverClaudeModels(),
    discoverCodexModels(),
    discoverGeminiModels(),
  ]);

  discoveryComplete = true;
  const count = Object.keys(dynamicModels).length;
  if (count > 0) {
    logger.info({ count }, "Discovered additional models at runtime");
  }
}

export function registerModel(model: IModelInfo): void {
  dynamicModels[model.id] = model;
  const provider = model.provider;
  if (!dynamicDisplayOrder[provider]) {
    dynamicDisplayOrder[provider] = [];
  }
  if (!dynamicDisplayOrder[provider].some((e) => e.id === model.id)) {
    dynamicDisplayOrder[provider].push({
      id: model.id,
      label: model.name,
      description: model.description ?? "",
    });
  }
}

export function getModelInfo(modelId: string): IModelInfo | undefined {
  return dynamicModels[modelId] ?? SUPPORTED_MODELS[modelId];
}

export function getAllModels(): Record<string, IModelInfo> {
  return { ...SUPPORTED_MODELS, ...dynamicModels };
}

export function getDisplayOrder(): Record<string, readonly IModelDisplayEntry[]> {
  const result: Record<string, IModelDisplayEntry[]> = {};

  for (const [provider, entries] of Object.entries(PROVIDER_MODEL_ORDER)) {
    result[provider] = [...entries];
  }

  // Prepend dynamic models to their provider group (new models show at top)
  for (const [provider, entries] of Object.entries(dynamicDisplayOrder)) {
    if (!result[provider]) {
      result[provider] = [];
    }
    for (const entry of entries) {
      if (!result[provider].some((e) => e.id === entry.id)) {
        result[provider].unshift(entry);
      }
    }
  }

  return result;
}

export function isKnownModel(modelId: string): boolean {
  return modelId in SUPPORTED_MODELS || modelId in dynamicModels;
}
