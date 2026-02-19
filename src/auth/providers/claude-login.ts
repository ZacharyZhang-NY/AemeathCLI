/**
 * Claude Code OAuth 2.0 + PKCE login
 * Uses the same client ID as the official Claude Code CLI.
 * After login, stores tokens in our credential store AND writes to macOS Keychain
 * so credentials are shared with the official Claude Code CLI.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { URL } from "node:url";
import type { ICredential } from "../../types/index.js";
import { AuthenticationError } from "../../types/index.js";
import { CredentialStore } from "../credential-store.js";
import { logger } from "../../utils/index.js";

const execFileAsync = promisify(execFile);

// ── Claude Code OAuth Config (same as official Claude Code CLI) ─────────

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const SCOPE = "user:inference";
const CALLBACK_TIMEOUT_MS = 300_000;
const LOCALHOST = "localhost";

// ── Also try reading from official Claude Code CLI's keychain ───────────

const KEYCHAIN_SERVICE = "Claude Code-credentials";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (typeof value === "string" && value.length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== "") {
      return asDate(numeric);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return undefined;
}

function parseKeychainCredential(raw: string): ICredential | undefined {
  if (raw.length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) {
    return undefined;
  }

  const directPayload = parsed;
  const nestedPayload = isRecord(parsed["claudeAiOauth"])
    ? parsed["claudeAiOauth"]
    : undefined;
  const payloads = nestedPayload ? [nestedPayload, directPayload] : [directPayload];

  for (const payload of payloads) {
    const accessToken = asString(payload["accessToken"]) ?? asString(payload["access_token"]);
    if (!accessToken) {
      continue;
    }

    const refreshToken = asString(payload["refreshToken"]) ?? asString(payload["refresh_token"]);
    const expiresAt = asDate(payload["expiresAt"] ?? payload["expires_at"]);
    const email = asString(payload["email"]);
    const plan = asString(payload["plan"])
      ?? asString(payload["subscriptionType"])
      ?? asString(payload["subscription_type"])
      ?? asString(payload["rateLimitTier"])
      ?? asString(payload["rate_limit_tier"]);

    return {
      provider: "anthropic",
      method: "native_login",
      token: accessToken,
      ...(refreshToken !== undefined ? { refreshToken } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(plan !== undefined ? { plan } : {}),
    };
  }

  return undefined;
}

async function readKeychainCredential(): Promise<ICredential | undefined> {
  if (process.platform !== "darwin") return undefined;

  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w",
    ], { timeout: 5000 });

    return parseKeychainCredential(stdout.trim());
  } catch {
    return undefined;
  }
}

// ── PKCE Helpers ────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ── HTML Responses ──────────────────────────────────────────────────────

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>AemeathCLI — Login Successful</title></head>
<body style="font-family:system-ui;text-align:center;padding:40px">
<h1>Login Successful</h1>
<p>You can close this window and return to your terminal.</p>
</body></html>`;
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html><head><title>AemeathCLI — Login Failed</title></head>
<body style="font-family:system-ui;text-align:center;padding:40px">
<h1>Login Failed</h1>
<p>${escapeHtml(message)}</p>
</body></html>`;
}

// ── ClaudeLogin Class ───────────────────────────────────────────────────

export class ClaudeLogin {
  private readonly credentialStore: CredentialStore;
  private callbackServer: Server | undefined;

  constructor(store?: CredentialStore) {
    this.credentialStore = store ?? new CredentialStore();
  }

  /**
   * Run browser-based OAuth 2.0 + PKCE login using the same client ID
   * as the official Claude Code CLI. Browser opens automatically.
   */
  async login(): Promise<ICredential> {
    // First try importing existing credentials from Claude Code's keychain
    const existing = await readKeychainCredential();
    if (existing && existing.token) {
      const isExpired = existing.expiresAt ? new Date() > existing.expiresAt : false;
      if (!isExpired) {
        logger.info("Imported existing Claude Code credentials from keychain");
        await this.credentialStore.set("anthropic", existing);
        return existing;
      }
    }

    // Run the OAuth flow — browser opens automatically
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    const { port, server } = await this.startCallbackServer();
    this.callbackServer = server;

    const redirectUri = `http://${LOCALHOST}:${port}/callback`;

    const authUrl = new URL(AUTHORIZE_URL);
    authUrl.searchParams.set("code", "true");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", SCOPE);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    logger.info("Opening browser for Claude OAuth login");

    try {
      const openModule = await import("open");
      await openModule.default(authUrl.toString());
    } catch {
      this.stopServer();
      throw new AuthenticationError("anthropic", "Failed to open browser for login");
    }

    try {
      const code = await this.waitForCallback(state);
      const credential = await this.exchangeCodeForToken(code, codeVerifier, redirectUri, state);

      await this.credentialStore.set("anthropic", credential);
      logger.info("Claude OAuth login successful");

      return credential;
    } finally {
      this.stopServer();
    }
  }

  async logout(): Promise<void> {
    await this.credentialStore.delete("anthropic");
    logger.info("Claude session revoked");
  }

  async isLoggedIn(): Promise<boolean> {
    const credential = await this.getCachedCredential();
    return credential !== undefined;
  }

  async getStatus(): Promise<{ loggedIn: boolean; email?: string | undefined; plan?: string | undefined }> {
    const loggedIn = await this.isLoggedIn();
    if (!loggedIn) return { loggedIn: false };

    const credential = await this.credentialStore.get("anthropic");
    if (!credential) return { loggedIn: false };

    return {
      loggedIn: true,
      ...(credential.email !== undefined ? { email: credential.email } : {}),
      ...(credential.plan !== undefined ? { plan: credential.plan } : {}),
    };
  }

  async getCachedCredential(): Promise<ICredential | undefined> {
    const existing = await this.credentialStore.get("anthropic");
    if (existing?.method === "native_login" && existing.token) {
      const isExpired = existing.expiresAt ? new Date() > existing.expiresAt : false;
      if (!isExpired) {
        return existing;
      }
    }

    const keychain = await readKeychainCredential();
    if (!keychain?.token) {
      return undefined;
    }

    const isExpired = keychain.expiresAt ? new Date() > keychain.expiresAt : false;
    if (isExpired) {
      return undefined;
    }

    await this.credentialStore.set("anthropic", keychain);
    return keychain;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private startCallbackServer(): Promise<{ port: number; server: Server }> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, LOCALHOST, () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          server.close();
          reject(new Error("Failed to bind callback server"));
          return;
        }
        resolve({ port: address.port, server });
      });
      server.on("error", reject);
    });
  }

  private waitForCallback(expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = this.callbackServer;
      if (server === undefined) {
        reject(new AuthenticationError("anthropic", "Callback server not started"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new AuthenticationError("anthropic", "Login timed out"));
      }, CALLBACK_TIMEOUT_MS);

      server.on("request", (req: IncomingMessage, res: ServerResponse) => {
        const requestUrl = new URL(req.url ?? "/", `http://${LOCALHOST}`);
        if (requestUrl.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        clearTimeout(timeout);

        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        const error = requestUrl.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(errorHtml(`OAuth error: ${error}`));
          reject(new AuthenticationError("anthropic", `OAuth error: ${error}`));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(errorHtml("State mismatch"));
          reject(new AuthenticationError("anthropic", "OAuth state mismatch"));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(errorHtml("Missing authorization code"));
          reject(new AuthenticationError("anthropic", "No authorization code received"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(successHtml());
        resolve(code);
      });
    });
  }

  private async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    redirectUri: string,
    state: string,
  ): Promise<ICredential> {
    const body = {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
      state,
    };

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new AuthenticationError("anthropic", `Token exchange failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      email?: string;
      plan?: string;
    };

    if (!data.access_token) {
      throw new AuthenticationError("anthropic", "Token exchange returned no access_token");
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined;

    return {
      provider: "anthropic",
      method: "native_login",
      token: data.access_token,
      ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.plan !== undefined ? { plan: data.plan } : {}),
    };
  }

  private stopServer(): void {
    if (this.callbackServer !== undefined) {
      this.callbackServer.close();
      this.callbackServer = undefined;
    }
  }
}
