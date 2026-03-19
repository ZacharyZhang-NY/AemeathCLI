/**
 * CLI Provider Manager — factory and registry for CLI provider adapters.
 *
 * Creates, stores, and retrieves CLI provider instances keyed by terminal ID.
 * Each terminal has exactly one CLI provider that manages its lifecycle.
 */

import type { CliProviderType } from "../constants.js";
import type { PtySessionManager } from "../pty/session-manager.js";
import type { BaseCliProvider } from "./base-cli-provider.js";
import { ClaudeCodeCliProvider } from "./claude-code-cli-provider.js";
import { CodexCliProvider } from "./codex-cli-provider.js";
import { GeminiCliProvider } from "./gemini-cli-provider.js";
import { KimiCliProvider } from "./kimi-cli-provider.js";
import { OllamaCliProvider } from "./ollama-cli-provider.js";

export class CliProviderManager {
  private readonly providers = new Map<string, BaseCliProvider>();

  /**
   * Create and register a CLI provider for the given terminal.
   * Returns the newly created provider instance.
   */
  create(
    type: CliProviderType,
    terminalId: string,
    sm: PtySessionManager,
    model?: string,
  ): BaseCliProvider {
    const p = this.instantiate(type, terminalId, sm, model);
    this.providers.set(terminalId, p);
    return p;
  }

  /** Retrieve a CLI provider by terminal ID, if it exists. */
  get(terminalId: string): BaseCliProvider | undefined {
    return this.providers.get(terminalId);
  }

  /** Remove a CLI provider registration for the given terminal. */
  remove(terminalId: string): void {
    this.providers.delete(terminalId);
  }

  /** Instantiate the correct CLI provider subclass for the given type. */
  private instantiate(
    type: CliProviderType,
    tid: string,
    sm: PtySessionManager,
    model?: string,
  ): BaseCliProvider {
    switch (type) {
      case "claude-code":
        return new ClaudeCodeCliProvider(tid, sm);
      case "codex":
        return new CodexCliProvider(tid, sm);
      case "gemini-cli":
        return new GeminiCliProvider(tid, sm);
      case "kimi-cli":
        return new KimiCliProvider(tid, sm);
      case "ollama":
        return new OllamaCliProvider(tid, sm, model);
    }
  }
}
