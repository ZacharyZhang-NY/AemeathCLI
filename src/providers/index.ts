/**
 * Provider layer — barrel export per PRD section 6.2
 */

export type { IModelProvider, IProviderOptions } from "./types.js";
export { ProviderRegistry } from "./registry.js";
export { ClaudeAdapter } from "./claude-adapter.js";
export { OpenAIAdapter } from "./openai-adapter.js";
export { GeminiAdapter } from "./gemini-adapter.js";
export { KimiAdapter } from "./kimi-adapter.js";
export { OllamaAdapter } from "./ollama-adapter.js";
export {
  ClaudeNativeCLIAdapter,
  CodexNativeCLIAdapter,
  GeminiNativeCLIAdapter,
  KimiNativeCLIAdapter,
} from "./native-cli-adapters.js";
