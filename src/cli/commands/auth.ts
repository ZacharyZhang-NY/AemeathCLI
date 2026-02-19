/**
 * Authentication management commands per PRD section 13.2
 */

import { Command } from "commander";
import pc from "picocolors";
import type { ProviderName } from "../../types/index.js";

const VALID_PROVIDERS = ["claude", "codex", "gemini", "kimi"] as const;
type LoginProvider = (typeof VALID_PROVIDERS)[number];

function isValidProvider(value: string): value is LoginProvider {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

const PROVIDER_MODEL_SWITCH: Readonly<Record<LoginProvider, { provider: ProviderName; model: string }>> = {
  claude: { provider: "anthropic", model: "claude-sonnet-4-6" },
  codex: { provider: "openai", model: "gpt-5.2" },
  gemini: { provider: "google", model: "gemini-2.5-pro" },
  kimi: { provider: "kimi", model: "kimi-k2.5" },
};

export function createAuthCommand(): Command {
  const auth = new Command("auth")
    .description("Authentication & account management");

  auth
    .command("login <provider>")
    .description("Log in to a provider (claude, codex, gemini, kimi)")
    .action(async (provider: string) => {
      if (!isValidProvider(provider)) {
        process.stderr.write(
          pc.red(`Unknown provider: "${provider}". Valid: ${VALID_PROVIDERS.join(", ")}\n`),
        );
        process.exitCode = 2;
        return;
      }

      process.stdout.write(pc.cyan(`Logging in to ${provider}...\n`));

      try {
        const loginModule = await loadLoginModule(provider);
        await loginModule.login();
        process.stdout.write(pc.green(`Successfully logged in to ${provider}\n`));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Login failed: ${message}\n`));
        process.exitCode = 3;
      }
    });

  auth
    .command("logout [provider]")
    .description("Log out of a provider (or all with --all)")
    .option("--all", "Log out of all providers")
    .action(async (provider: string | undefined, options: { all?: boolean }) => {
      if (options.all) {
        for (const p of VALID_PROVIDERS) {
          try {
            const loginModule = await loadLoginModule(p);
            await loginModule.logout();
            process.stdout.write(pc.green(`Logged out of ${p}\n`));
          } catch {
            // Some may not be logged in
          }
        }
        return;
      }

      if (!provider || !isValidProvider(provider)) {
        process.stderr.write(
          pc.red(`Specify a provider or use --all. Valid: ${VALID_PROVIDERS.join(", ")}\n`),
        );
        process.exitCode = 2;
        return;
      }

      try {
        const loginModule = await loadLoginModule(provider);
        await loginModule.logout();
        process.stdout.write(pc.green(`Logged out of ${provider}\n`));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Logout failed: ${message}\n`));
        process.exitCode = 3;
      }
    });

  auth
    .command("status")
    .description("Show login status for all providers")
    .action(async () => {
      for (const provider of VALID_PROVIDERS) {
        try {
          const loginModule = await loadLoginModule(provider);
          const status = await loginModule.getStatus();
          if (status.loggedIn) {
            process.stdout.write(
              pc.green(`  ✓ ${provider}`) +
                ` — Logged in as ${status.email ?? "unknown"} (${status.plan ?? "unknown plan"})\n`,
            );
          } else {
            process.stdout.write(pc.red(`  ✗ ${provider}`) + " — Not logged in\n");
          }
        } catch {
          process.stdout.write(pc.red(`  ✗ ${provider}`) + " — Not configured\n");
        }
      }

      try {
        const { ApiKeyFallback } = await import("../../auth/api-key-fallback.js");
        const fallback = new ApiKeyFallback();
        const apiKeyStatus: ReadonlyArray<{ label: string; provider: ProviderName }> = [
          { label: "Claude", provider: "anthropic" },
          { label: "OpenAI", provider: "openai" },
          { label: "Google", provider: "google" },
          { label: "Kimi", provider: "kimi" },
        ];

        process.stdout.write("\nFallback API keys:\n");
        for (const item of apiKeyStatus) {
          const hasKey = await fallback.hasKey(item.provider);
          process.stdout.write(`  ${item.label}: ${hasKey ? "set" : "not set"}\n`);
        }
      } catch {
        // Best-effort status output
      }
    });

  auth
    .command("set-key <provider> <key>")
    .description("Set an API key for a provider (fallback for CI/headless)")
    .action(async (provider: string, key: string) => {
      if (!isValidProvider(provider) && provider !== "openai" && provider !== "google") {
        process.stderr.write(pc.red(`Unknown provider: "${provider}"\n`));
        process.exitCode = 2;
        return;
      }

      try {
        const { ApiKeyFallback } = await import("../../auth/api-key-fallback.js");
        const fallback = new ApiKeyFallback();
        const providerMap: Record<string, ProviderName> = {
          claude: "anthropic",
          openai: "openai",
          codex: "openai",
          gemini: "google",
          google: "google",
          kimi: "kimi",
        };
        const mappedProvider = providerMap[provider];
        if (mappedProvider) {
          await fallback.setKey(mappedProvider, key);
          process.stdout.write(pc.green(`API key set for ${provider}\n`));
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Failed to set key: ${message}\n`));
        process.exitCode = 3;
      }
    });

  auth
    .command("switch <provider>")
    .description("Set a provider as the default")
    .action(async (provider: string) => {
      if (!isValidProvider(provider)) {
        process.stderr.write(
          pc.red(`Unknown provider: "${provider}". Valid: ${VALID_PROVIDERS.join(", ")}\n`),
        );
        process.exitCode = 2;
        return;
      }

      try {
        const target = PROVIDER_MODEL_SWITCH[provider];
        const { ConfigStore } = await import("../../storage/config-store.js");
        const store = new ConfigStore();
        const cfg = store.loadGlobal();

        const nextConfig = {
          ...cfg,
          defaultModel: target.model,
          providers: {
            ...cfg.providers,
            [target.provider]: {
              ...(cfg.providers[target.provider] ?? {}),
              enabled: true,
            },
          },
        };

        store.saveGlobal(nextConfig);
        process.stdout.write(
          pc.green(`Default provider switched to ${provider} (model: ${target.model})\n`),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Failed to switch provider: ${message}\n`));
        process.exitCode = 3;
      }
    });

  return auth;
}

interface ILoginModule {
  login(): Promise<unknown>;
  logout(): Promise<void>;
  getStatus(): Promise<{ loggedIn: boolean; email?: string | undefined; plan?: string | undefined }>;
}

async function loadLoginModule(provider: LoginProvider): Promise<ILoginModule> {
  switch (provider) {
    case "claude": {
      const mod = await import("../../auth/providers/claude-login.js");
      return new mod.ClaudeLogin();
    }
    case "codex": {
      const mod = await import("../../auth/providers/codex-login.js");
      return new mod.CodexLogin();
    }
    case "gemini": {
      const mod = await import("../../auth/providers/gemini-login.js");
      return new mod.GeminiLogin();
    }
    case "kimi": {
      const mod = await import("../../auth/providers/kimi-login.js");
      return new mod.KimiLogin();
    }
  }
}
