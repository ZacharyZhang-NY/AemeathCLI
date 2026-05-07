import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execa } from "execa";
import open from "open";
import { input } from "@inquirer/prompts";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import type { OAuthProviderId } from "@mariozechner/pi-ai";
import { loadConfig } from "../config/loader.js";
import { createAemeathAuthStorage } from "../core/auth.js";

export type LoginProvider = "claude" | "codex" | "gemini" | "kimi";

export interface AuthStatusRecord {
  provider: LoginProvider;
  loggedIn: boolean;
  method: "oauth" | "api_key" | "none";
  backingProviders: string[];
}

interface ProviderRuntimeConfig {
  oauthProviderId?: OAuthProviderId;
  credentialProviders: string[];
  apiKeyProvider: string;
}

const PROVIDER_CONFIG: Record<LoginProvider, ProviderRuntimeConfig> = {
  claude: {
    oauthProviderId: "anthropic",
    credentialProviders: ["anthropic"],
    apiKeyProvider: "anthropic",
  },
  codex: {
    oauthProviderId: "openai-codex",
    credentialProviders: ["openai-codex", "openai"],
    apiKeyProvider: "openai",
  },
  gemini: {
    oauthProviderId: "google-gemini-cli",
    credentialProviders: ["google-gemini-cli", "google"],
    apiKeyProvider: "google",
  },
  kimi: {
    credentialProviders: ["kimi-coding"],
    apiKeyProvider: "kimi-coding",
  },
};

interface KimiCredentialsFile {
  access_token?: string;
}

function getAuthStorage(): AuthStorage {
  const config = loadConfig(process.cwd());
  return createAemeathAuthStorage(config);
}

function getKimiCredentialsPath(): string {
  return join(process.env["KIMI_HOME"] ?? join(homedir(), ".kimi"), "credentials", "kimi-code.json");
}

function readKimiAccessToken(): string | undefined {
  const path = getKimiCredentialsPath();
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as KimiCredentialsFile;
    return typeof parsed.access_token === "string" && parsed.access_token.length > 0 ? parsed.access_token : undefined;
  } catch {
    return undefined;
  }
}

async function loginWithOAuth(authStorage: AuthStorage, providerId: OAuthProviderId): Promise<void> {
  await authStorage.login(providerId, {
    onAuth: ({ url, instructions }) => {
      void open(url);
      if (instructions) {
        process.stdout.write(`${instructions}\n`);
      }
      process.stdout.write(`Open this URL if the browser did not launch automatically:\n${url}\n`);
    },
    onPrompt: async ({ message, placeholder }) => {
      return input(placeholder ? { message, default: placeholder } : { message });
    },
    onProgress: (message) => {
      process.stdout.write(`${message}\n`);
    },
    onManualCodeInput: async () => {
      return input({ message: "Paste the redirect URL or code" });
    },
  });
}

async function loginKimi(authStorage: AuthStorage): Promise<void> {
  const existing = readKimiAccessToken();
  if (existing) {
    authStorage.set("kimi-coding", { type: "api_key", key: existing });
    return;
  }

  try {
    await execa("kimi", ["login"], { stdio: "inherit", timeout: 300_000 });
  } catch {
    await execa("kimi", [], { stdio: "inherit", timeout: 300_000 });
  }

  const token = readKimiAccessToken();
  if (!token) {
    throw new Error("Kimi login completed but no access token was found in ~/.kimi/credentials/kimi-code.json");
  }

  authStorage.set("kimi-coding", { type: "api_key", key: token });
}

export async function loginProvider(provider: LoginProvider): Promise<void> {
  const authStorage = getAuthStorage();
  const config = PROVIDER_CONFIG[provider];

  if (provider === "kimi") {
    await loginKimi(authStorage);
    return;
  }

  if (!config.oauthProviderId) {
    throw new Error(`Provider ${provider} does not support OAuth login`);
  }

  await loginWithOAuth(authStorage, config.oauthProviderId);
}

export function logoutProvider(provider: LoginProvider): void {
  const authStorage = getAuthStorage();
  for (const credentialProvider of PROVIDER_CONFIG[provider].credentialProviders) {
    authStorage.logout(credentialProvider);
  }
}

export function setProviderApiKey(provider: LoginProvider, key: string): void {
  const authStorage = getAuthStorage();
  authStorage.set(PROVIDER_CONFIG[provider].apiKeyProvider, { type: "api_key", key });
}

export function getAuthStatusRecord(provider: LoginProvider): AuthStatusRecord {
  const authStorage = getAuthStorage();
  const backingProviders = PROVIDER_CONFIG[provider].credentialProviders;

  for (const backingProvider of backingProviders) {
    const credential = authStorage.get(backingProvider);
    if (!credential) {
      continue;
    }

    return {
      provider,
      loggedIn: true,
      method: credential.type,
      backingProviders,
    };
  }

  for (const backingProvider of backingProviders) {
    if (authStorage.hasAuth(backingProvider)) {
      return {
        provider,
        loggedIn: true,
        method: "api_key",
        backingProviders,
      };
    }
  }

  return {
    provider,
    loggedIn: false,
    method: "none",
    backingProviders,
  };
}

export function getAuthStatusRecords(): AuthStatusRecord[] {
  return ["claude", "codex", "gemini", "kimi"].map((provider) => getAuthStatusRecord(provider as LoginProvider));
}

export function formatDetailedAuthStatusLine(record: AuthStatusRecord): string {
  if (!record.loggedIn) {
    return `${record.provider.padEnd(8)} ○ Not logged in`;
  }

  return `${record.provider.padEnd(8)} ● Logged in via ${record.method}`;
}

export function formatCompactAuthStatusLine(record: AuthStatusRecord): string {
  return record.loggedIn ? `${record.provider}: logged in` : `${record.provider}: logged out`;
}
