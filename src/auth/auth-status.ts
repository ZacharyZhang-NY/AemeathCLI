import { ApiKeyFallback } from "./api-key-fallback.js";
import { SessionManager } from "./session-manager.js";
import type { AuthMethod, ProviderName } from "../types/index.js";

export const LOGIN_PROVIDERS = ["claude", "codex", "gemini", "kimi"] as const;
export type LoginProvider = (typeof LOGIN_PROVIDERS)[number];

export interface IAuthStatusRecord {
  readonly provider: LoginProvider;
  readonly loggedIn: boolean;
  readonly authMethod?: AuthMethod;
  readonly email?: string;
  readonly plan?: string;
  readonly launchReady: boolean;
  readonly launchMethod?: AuthMethod;
}

const PROVIDER_MODEL_SWITCH: Readonly<Record<LoginProvider, { provider: ProviderName; model: string }>> = {
  claude: { provider: "anthropic", model: "claude-sonnet-4-6" },
  codex: { provider: "openai", model: "gpt-5.2" },
  gemini: { provider: "google", model: "gemini-2.5-pro" },
  kimi: { provider: "kimi", model: "kimi-for-coding" },
};

function formatAuthMethodLabel(method?: AuthMethod): string {
  switch (method) {
    case "native_login":
      return "CLI login";
    case "api_key":
      return "API key";
    case "env_variable":
      return "env var";
    case "credential_helper":
      return "credential helper";
    default:
      return "configured";
  }
}

function formatCompactLoginState(email?: string, plan?: string): string {
  if (email !== undefined && plan !== undefined) {
    return `Logged in as ${email} (${plan})`;
  }

  if (email !== undefined) {
    return `Logged in as ${email}`;
  }

  if (plan !== undefined) {
    return `Logged in (${plan})`;
  }

  return "Logged in";
}

export async function getAuthStatusRecord(provider: LoginProvider): Promise<IAuthStatusRecord> {
  const providerName = PROVIDER_MODEL_SWITCH[provider].provider;
  const sessionManager = new SessionManager();
  const fallback = new ApiKeyFallback();
  const activeCredential = await sessionManager.getActiveCredential(providerName).catch(() => undefined);
  const storedApiKey = await fallback.getCredential(providerName);
  const envCredential = fallback.getFromEnvironment(providerName);
  const launchCredential = storedApiKey ?? envCredential;

  let email: string | undefined;
  let plan: string | undefined;
  if (activeCredential?.method === "native_login") {
    const status = await sessionManager.getStatus(providerName);
    email = status.email;
    plan = status.plan;
  }

  // Swarm mode is ready if ANY credential exists — native CLI login (OAuth)
  // is sufficient because the native CLI adapters shell out to the provider's
  // own CLI (claude, codex, gemini, kimi) which already holds the session.
  const launchReady = activeCredential !== undefined || launchCredential !== undefined;
  const launchMethod = launchCredential?.method ?? activeCredential?.method;

  return {
    provider,
    loggedIn: activeCredential !== undefined,
    ...(activeCredential?.method !== undefined ? { authMethod: activeCredential.method } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(plan !== undefined ? { plan } : {}),
    launchReady,
    ...(launchMethod !== undefined ? { launchMethod } : {}),
  };
}

export async function getAuthStatusRecords(): Promise<readonly IAuthStatusRecord[]> {
  return Promise.all(LOGIN_PROVIDERS.map(async (provider) => getAuthStatusRecord(provider)));
}

export function formatDetailedAuthStatusLine(record: IAuthStatusRecord): string {
  if (!record.loggedIn) {
    return `  ✗ ${record.provider} — Not logged in`;
  }

  const identity =
    record.email !== undefined
      ? ` as ${record.email}${record.plan !== undefined ? ` (${record.plan})` : ""}`
      : record.plan !== undefined
        ? ` (${record.plan})`
        : "";
  const launchStatus = record.launchReady
    ? `swarm-ready via ${formatAuthMethodLabel(record.launchMethod)}`
    : "not authenticated — run `aemeathcli auth login` or set an API key";

  return `  ✓ ${record.provider} — ${formatAuthMethodLabel(record.authMethod)}${identity}; ${launchStatus}`;
}

export function formatCompactAuthStatusLine(record: IAuthStatusRecord): string {
  if (!record.loggedIn) {
    return `  ✗ ${record.provider} — Not logged in`;
  }

  if (record.authMethod === "native_login" || record.authMethod === undefined) {
    return `  ✓ ${record.provider} — ${formatCompactLoginState(record.email, record.plan)}`;
  }

  return `  ✓ ${record.provider} — Configured via ${formatAuthMethodLabel(record.authMethod)}`;
}
