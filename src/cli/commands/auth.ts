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

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

function validProvidersMessage(): string {
  return VALID_PROVIDERS.join(", ");
}

async function promptForProvider(): Promise<LoginProvider> {
  const { select } = await import("@inquirer/prompts");
  return select<LoginProvider>({
    message: "Select a provider to log in to:",
    choices: [
      { name: "Claude  (Anthropic)", value: "claude" },
      { name: "Codex   (OpenAI)", value: "codex" },
      { name: "Gemini  (Google)", value: "gemini" },
      { name: "Kimi    (Moonshot)", value: "kimi" },
    ],
  });
}

async function readSecretFromStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(String(chunk));
  }
  return chunks.join("").trim();
}

async function resolveLoginProvider(providerArg: string | undefined): Promise<LoginProvider | undefined> {
  if (providerArg !== undefined) {
    if (!isValidProvider(providerArg)) {
      process.stderr.write(
        pc.red(`Unknown provider: "${providerArg}". Valid: ${validProvidersMessage()}\n`),
      );
      process.exitCode = 2;
      return undefined;
    }
    return providerArg;
  }

  if (!isInteractiveTerminal()) {
    process.stderr.write(
      pc.red(
        "Interactive provider selection requires a TTY. Use `aemeathcli auth login <provider>` or `aemeathcli auth set-key <provider> --stdin`.\n",
      ),
    );
    process.exitCode = 2;
    return undefined;
  }

  return promptForProvider();
}

async function runLoginFlow(provider: LoginProvider): Promise<void> {
  process.stdout.write(pc.cyan(`Logging in to ${provider}...\n`));

  const loginModule = await loadLoginModule(provider);
  await loginModule.login();
  process.stdout.write(pc.green(`Successfully logged in to ${provider}\n`));
}

interface IAuthStatusRecord {
  readonly provider: LoginProvider;
  readonly loggedIn: boolean;
  readonly authMethod?: string | undefined;
  readonly email?: string | undefined;
  readonly plan?: string | undefined;
  readonly launchReady: boolean;
  readonly launchMethod?: string | undefined;
}

async function getAuthStatusRecord(provider: LoginProvider): Promise<IAuthStatusRecord> {
  const providerName = PROVIDER_MODEL_SWITCH[provider].provider;
  const { SessionManager } = await import("../../auth/session-manager.js");
  const { ApiKeyFallback } = await import("../../auth/api-key-fallback.js");

  const sessionManager = new SessionManager();
  const fallback = new ApiKeyFallback();
  const activeCredential = await sessionManager.getActiveCredential(providerName).catch(() => undefined);
  const storedApiKey = await fallback.getCredential(providerName);
  const envCredential = fallback.getFromEnvironment(providerName);
  const launchCredential = storedApiKey ?? envCredential;

  let email: string | undefined;
  let plan: string | undefined;
  if (activeCredential?.method === "native_login") {
    const loginModule = await loadLoginModule(provider);
    const status = await loginModule
      .getStatus()
      .catch(() => ({ loggedIn: true, email: undefined, plan: undefined }));
    email = status.email;
    plan = status.plan;
  }

  return {
    provider,
    loggedIn: activeCredential !== undefined,
    authMethod: activeCredential?.method,
    email,
    plan,
    launchReady: launchCredential !== undefined,
    launchMethod: launchCredential?.method,
  };
}

const PROVIDER_MODEL_SWITCH: Readonly<Record<LoginProvider, { provider: ProviderName; model: string }>> = {
  claude: { provider: "anthropic", model: "claude-sonnet-4-6" },
  codex: { provider: "openai", model: "gpt-5.2" },
  gemini: { provider: "google", model: "gemini-2.5-pro" },
  kimi: { provider: "kimi", model: "kimi-for-coding" },
};

/**
 * Top-level `login` command with interactive provider selection.
 * Shows an arrow-key navigable list of providers, then triggers
 * browser-based login for the selected one.
 */
export function createLoginCommand(): Command {
  return new Command("login")
    .description("Log in to a provider (interactive)")
    .argument("[provider]", "Provider to log in to (claude, codex, gemini, kimi)")
    .action(async (providerArg: string | undefined) => {
      const provider = await resolveLoginProvider(providerArg);
      if (provider === undefined) {
        return;
      }

      try {
        await runLoginFlow(provider);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(pc.red(`Login failed: ${message}\n`));
        process.exitCode = 3;
      }
    });
}

export function createAuthCommand(): Command {
  const auth = new Command("auth")
    .description("Authentication & account management");

  auth
    .command("login [provider]")
    .description("Log in to a provider (claude, codex, gemini, kimi)")
    .action(async (providerArg: string | undefined) => {
      const provider = await resolveLoginProvider(providerArg);
      if (provider === undefined) {
        return;
      }

      try {
        await runLoginFlow(provider);
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
    .option("--json", "Output machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const records = await Promise.all(VALID_PROVIDERS.map(async (provider) => getAuthStatusRecord(provider)));

      if (options.json) {
        process.stdout.write(`${JSON.stringify({ providers: records }, null, 2)}\n`);
        return;
      }

      for (const record of records) {
        if (!record.loggedIn) {
          process.stdout.write(pc.red(`  ✗ ${record.provider}`) + " — Not logged in\n");
          continue;
        }

        const identity =
          record.email !== undefined
            ? ` as ${record.email}${record.plan !== undefined ? ` (${record.plan})` : ""}`
            : "";
        const launchStatus = record.launchReady
          ? `launch-ready via ${record.launchMethod ?? "api key"}`
          : "launch needs API key or env var";

        process.stdout.write(
          pc.green(`  ✓ ${record.provider}`) +
            ` — ${record.authMethod ?? "configured"}${identity}; ${launchStatus}\n`,
        );
      }
    });

  auth
    .command("set-key <provider> [key]")
    .description("Set an API key for a provider (fallback for CI/headless)")
    .option("--stdin", "Read the API key from stdin")
    .action(async (provider: string, key: string | undefined, options: { stdin?: boolean }) => {
      if (!isValidProvider(provider) && provider !== "openai" && provider !== "google") {
        process.stderr.write(pc.red(`Unknown provider: "${provider}"\n`));
        process.exitCode = 2;
        return;
      }

      const resolvedKey = options.stdin ? await readSecretFromStdin() : key;
      if (!resolvedKey) {
        process.stderr.write(
          pc.red("Provide an API key argument or use --stdin to read it from standard input.\n"),
        );
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
          await fallback.setKey(mappedProvider, resolvedKey);
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
