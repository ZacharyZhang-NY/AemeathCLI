import { describe, expect, it } from "vitest";
import { CLI_PROVIDERS } from "../../src/orchestrator/constants.js";
import {
  CLI_PROVIDER_CATALOG,
  CLI_PROVIDER_ORDER,
  getCliProviderEntry,
  getCliProviderForModelProvider,
  getCliProviderLabel,
} from "../../src/orchestrator/utils/provider-catalog.js";

describe("provider-catalog", () => {
  it("keeps provider order aligned with the orchestrator provider list", () => {
    expect(CLI_PROVIDER_ORDER).toEqual(CLI_PROVIDERS);
  });

  it("stores catalog entries keyed by their own provider type", () => {
    for (const provider of CLI_PROVIDER_ORDER) {
      const entry = getCliProviderEntry(provider);

      expect(CLI_PROVIDER_CATALOG[provider]).toBe(entry);
      expect(entry.type).toBe(provider);
    }
  });

  it("returns the configured display label for a provider", () => {
    const label = getCliProviderLabel("gemini-cli");

    expect(label).toBe("Gemini CLI");
  });

  it("maps SDK provider names back to the matching CLI provider", () => {
    expect(getCliProviderForModelProvider("anthropic")).toBe("claude-code");
    expect(getCliProviderForModelProvider("openai")).toBe("codex");
    expect(getCliProviderForModelProvider("google")).toBe("gemini-cli");
    expect(getCliProviderForModelProvider("kimi")).toBe("kimi-cli");
    expect(getCliProviderForModelProvider("ollama")).toBe("ollama");
  });

  it("returns undefined when no CLI provider matches the SDK provider", () => {
    const result = getCliProviderForModelProvider("unknown-provider" as never);

    expect(result).toBeUndefined();
  });

  it("marks hosted providers as login-capable and ollama as local-only", () => {
    expect(getCliProviderEntry("claude-code")).toMatchObject({
      localOnly: false,
      loginProvider: "claude",
    });
    expect(getCliProviderEntry("codex")).toMatchObject({
      localOnly: false,
      loginProvider: "codex",
    });
    expect(getCliProviderEntry("gemini-cli")).toMatchObject({
      localOnly: false,
      loginProvider: "gemini",
    });
    expect(getCliProviderEntry("kimi-cli")).toMatchObject({
      localOnly: false,
      loginProvider: "kimi",
    });

    const ollamaEntry = getCliProviderEntry("ollama");
    expect(ollamaEntry.localOnly).toBe(true);
    expect(ollamaEntry.loginProvider).toBeUndefined();
  });

  it("builds ollama start commands with default and explicit models", () => {
    const entry = getCliProviderEntry("ollama");

    expect(entry.startCommand()).toBe("ollama run llama3");
    expect(entry.startCommand("deepseek-r1")).toBe("ollama run deepseek-r1");
  });

  it("ignores the model argument for fixed-command providers", () => {
    const entry = getCliProviderEntry("codex");

    expect(entry.startCommand()).toBe("codex --full-auto");
    expect(entry.startCommand("gpt-5.4")).toBe("codex --full-auto");
  });
});
