import { Command } from "commander";
import pc from "picocolors";
import { select } from "@inquirer/prompts";
import { loadGlobalConfigFile, saveGlobalConfig } from "../../config/persist.js";
import type { ProviderName } from "../../types/model.js";
import {
  formatDetailedAuthStatusLine,
  getAuthStatusRecord,
  getAuthStatusRecords,
  loginProvider,
  logoutProvider,
  setProviderApiKey,
  type LoginProvider,
} from "../auth-runtime.js";

const VALID_PROVIDERS: readonly LoginProvider[] = ["claude", "codex", "gemini", "kimi"];

function isValidProvider(value: string): value is LoginProvider {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

function validProvidersMessage(): string {
  return VALID_PROVIDERS.join(", ");
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

async function promptForProvider(): Promise<LoginProvider> {
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
      process.stderr.write(pc.red(`Unknown provider: "${providerArg}". Valid: ${validProvidersMessage()}\n`));
      process.exitCode = 2;
      return undefined;
    }
    return providerArg;
  }

  if (!isInteractiveTerminal()) {
    process.stderr.write(
      pc.red("Interactive provider selection requires a TTY. Use `aemeathcli auth login <provider>`.\n"),
    );
    process.exitCode = 2;
    return undefined;
  }

  return promptForProvider();
}

async function runLoginFlow(provider: LoginProvider): Promise<void> {
  process.stdout.write(pc.cyan(`Logging in to ${provider}...\n`));
  await loginProvider(provider);
  process.stdout.write(pc.green(`Successfully logged in to ${provider}\n`));
}

const PROVIDER_MODEL_SWITCH: Readonly<Record<LoginProvider, { provider: ProviderName; model: string }>> = {
  claude: { provider: "anthropic", model: "claude-sonnet-4-6" },
  codex: { provider: "openai", model: "gpt-5.2" },
  gemini: { provider: "google", model: "gemini-2.5-pro" },
  kimi: { provider: "kimi", model: "kimi-k2.5" },
};

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
  const auth = new Command("auth").description("Authentication & account management");

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
    .action((provider: string | undefined, options: { all?: boolean }) => {
      if (options.all) {
        for (const item of VALID_PROVIDERS) {
          logoutProvider(item);
          process.stdout.write(pc.green(`Logged out of ${item}\n`));
        }
        return;
      }

      if (!provider || !isValidProvider(provider)) {
        process.stderr.write(pc.red(`Specify a provider or use --all. Valid: ${validProvidersMessage()}\n`));
        process.exitCode = 2;
        return;
      }

      logoutProvider(provider);
      process.stdout.write(pc.green(`Logged out of ${provider}\n`));
    });

  auth
    .command("status")
    .description("Show login status for all providers")
    .option("--json", "Output machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const records = getAuthStatusRecords();
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ providers: records }, null, 2)}\n`);
        return;
      }

      for (const record of records) {
        const line = formatDetailedAuthStatusLine(record);
        process.stdout.write(`${record.loggedIn ? pc.green(line) : pc.red(line)}\n`);
      }
    });

  auth
    .command("set-key <provider> [key]")
    .description("Set an API key for a provider")
    .option("--stdin", "Read the API key from stdin")
    .action(async (provider: string, key: string | undefined, options: { stdin?: boolean }) => {
      if (!isValidProvider(provider)) {
        process.stderr.write(pc.red(`Unknown provider: "${provider}". Valid: ${validProvidersMessage()}\n`));
        process.exitCode = 2;
        return;
      }

      const resolvedKey = options.stdin ? await readSecretFromStdin() : key;
      if (!resolvedKey) {
        process.stderr.write(pc.red("Provide an API key argument or use --stdin.\n"));
        process.exitCode = 2;
        return;
      }

      setProviderApiKey(provider, resolvedKey);
      process.stdout.write(pc.green(`API key set for ${provider}\n`));
    });

  auth
    .command("switch <provider>")
    .description("Set a provider as the default")
    .action((provider: string) => {
      if (!isValidProvider(provider)) {
        process.stderr.write(pc.red(`Unknown provider: "${provider}". Valid: ${validProvidersMessage()}\n`));
        process.exitCode = 2;
        return;
      }

      const target = PROVIDER_MODEL_SWITCH[provider];
      const current = loadGlobalConfigFile();
      saveGlobalConfig({
        ...current,
        roles: {
          ...current.roles,
          coding: {
            ...current.roles.coding,
            primary: target.model,
          },
        },
      });
      process.stdout.write(pc.green(`Default provider switched to ${provider} (model: ${target.model})\n`));
    });

  auth
    .command("whoami <provider>")
    .description("Show status for one provider")
    .action((provider: string) => {
      if (!isValidProvider(provider)) {
        process.stderr.write(pc.red(`Unknown provider: "${provider}". Valid: ${validProvidersMessage()}\n`));
        process.exitCode = 2;
        return;
      }
      const record = getAuthStatusRecord(provider);
      process.stdout.write(`${formatDetailedAuthStatusLine(record)}\n`);
    });

  return auth;
}
