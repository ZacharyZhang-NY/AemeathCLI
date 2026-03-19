/**
 * Cross-platform CLI provider detection utility.
 *
 * Probes the system PATH for known AI CLI tools by running
 * `<tool> --version` with a 5-second timeout. Returns a list
 * of provider types that are available on the current machine.
 *
 * @see IMPLEMENT_PLAN.md Section 10
 */

import { spawnSync } from "node:child_process";
import type { CliProviderType } from "../constants.js";

const PROVIDER_COMMANDS: Record<CliProviderType, readonly string[]> = {
  "claude-code": ["claude", "--version"],
  "codex": ["codex", "--version"],
  "gemini-cli": ["gemini", "--version"],
  "kimi-cli": ["kimi", "--version"],
  "ollama": ["ollama", "--version"],
};

/**
 * Detect which CLI AI providers are installed on the system.
 *
 * Each provider is checked by running its version command. Only
 * providers that exit with status 0 are included in the result.
 *
 * @returns Array of installed CLI provider types.
 */
export function detectInstalledProviders(): CliProviderType[] {
  const available: CliProviderType[] = [];

  for (const [provider, [cmd, ...args]] of Object.entries(PROVIDER_COMMANDS)) {
    try {
      if (cmd === undefined) continue;
      const result = spawnSync(cmd, args, {
        stdio: "ignore",
        timeout: 5000,
        shell: process.platform === "win32",
      });
      if (result.status === 0) {
        available.push(provider as CliProviderType);
      }
    } catch {
      // Not installed — skip
    }
  }

  return available;
}
