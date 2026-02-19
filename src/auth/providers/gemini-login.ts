/**
 * Gemini (Google) OAuth login
 * Uses the same client ID as the official Gemini CLI.
 * After login, stores tokens at ~/.gemini/oauth_creds.json
 * so credentials are shared with the official Gemini CLI.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { URL } from "node:url";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ICredential } from "../../types/index.js";
import { AuthenticationError } from "../../types/index.js";
import { CredentialStore } from "../credential-store.js";
import { logger } from "../../utils/index.js";

// ── Gemini CLI OAuth Config (same as official Gemini CLI) ───────────────

const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language",
].join(" ");
const CALLBACK_TIMEOUT_MS = 300_000;
const LOCALHOST = "127.0.0.1";

// ── Gemini CLI Token Paths ──────────────────────────────────────────────

function getGeminiHome(): string {
  return process.env["GEMINI_HOME"] ?? join(homedir(), ".gemini");
}

function getOAuthCredsPath(): string {
  return join(getGeminiHome(), "oauth_creds.json");
}

function getGoogleAccountsPath(): string {
  return join(getGeminiHome(), "google_accounts.json");
}

// ── Read existing tokens from Gemini CLI cache ──────────────────────────

interface IGeminiOAuthCreds {
  readonly access_token?: string;
  readonly scope?: string;
  readonly token_type?: string;
  readonly id_token?: string;
  readonly expiry_date?: number;
  readonly refresh_token?: string;
}

interface IGoogleAccounts {
  readonly active?: string;
}

function readOAuthCreds(): IGeminiOAuthCreds | undefined {
  const credsPath = getOAuthCredsPath();
  if (!existsSync(credsPath)) return undefined;
  try {
    return JSON.parse(readFileSync(credsPath, "utf-8")) as IGeminiOAuthCreds;
  } catch {
    return undefined;
  }
}

function readGoogleAccounts(): IGoogleAccounts | undefined {
  const accountsPath = getGoogleAccountsPath();
  if (!existsSync(accountsPath)) return undefined;
  try {
    return JSON.parse(readFileSync(accountsPath, "utf-8")) as IGoogleAccounts;
  } catch {
    return undefined;
  }
}

// ── Write tokens in Gemini CLI format ───────────────────────────────────

function writeOAuthCreds(creds: IGeminiOAuthCreds): void {
  const geminiHome = getGeminiHome();
  try {
    if (!existsSync(geminiHome)) {
      mkdirSync(geminiHome, { recursive: true, mode: 0o700 });
    }
    writeFileSync(getOAuthCredsPath(), JSON.stringify(creds, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch (error: unknown) {
    logger.warn({ err: error }, "Failed to write Gemini oauth_creds.json");
  }
}

function writeGoogleAccounts(email: string): void {
  const geminiHome = getGeminiHome();
  try {
    if (!existsSync(geminiHome)) {
      mkdirSync(geminiHome, { recursive: true, mode: 0o700 });
    }
    const existing = readGoogleAccounts();
    const data = { active: email, old: existing?.active && existing.active !== email ? [existing.active] : [] };
    writeFileSync(getGoogleAccountsPath(), JSON.stringify(data, null, 2), { encoding: "utf-8" });
  } catch {
    // Non-critical
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
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>AemeathCLI — Google Login Successful</title></head>
<body style="font-family:system-ui;text-align:center;padding:40px">
<h1>Google Login Successful</h1>
<p>You can close this window and return to your terminal.</p>
</body></html>`;
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html><head><title>AemeathCLI — Google Login Failed</title></head>
<body style="font-family:system-ui;text-align:center;padding:40px">
<h1>Login Failed</h1>
<p>${escapeHtml(message)}</p>
</body></html>`;
}

function extractEmailFromIdToken(idToken: string): string | undefined {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return decoded.email;
  } catch {
    return undefined;
  }
}

// ── GeminiLogin Class ───────────────────────────────────────────────────

export class GeminiLogin {
  private readonly credentialStore: CredentialStore;
  private callbackServer: Server | undefined;

  constructor(store?: CredentialStore) {
    this.credentialStore = store ?? new CredentialStore();
  }

  /**
   * Run browser-based Google OAuth login using the same client ID
   * as the official Gemini CLI. Browser opens automatically.
   */
  async login(): Promise<ICredential> {
    // First try importing existing credentials from Gemini CLI's cache
    const existing = this.readCachedCredential();
    if (existing) {
      const isExpired = existing.expiresAt ? new Date() > existing.expiresAt : false;
      if (!isExpired) {
        logger.info("Imported existing Gemini CLI credentials");
        await this.credentialStore.set("google", existing);
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
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPE);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    logger.info("Opening browser for Google OAuth login");

    try {
      const openModule = await import("open");
      await openModule.default(authUrl.toString());
    } catch {
      this.stopServer();
      throw new AuthenticationError("google", "Failed to open browser for login");
    }

    try {
      const code = await this.waitForCallback(state);
      const credential = await this.exchangeCodeForToken(code, codeVerifier, redirectUri);

      await this.credentialStore.set("google", credential);
      logger.info("Google OAuth login successful");

      return credential;
    } finally {
      this.stopServer();
    }
  }

  async logout(): Promise<void> {
    await this.credentialStore.delete("google");
    logger.info("Google session revoked");
  }

  async isLoggedIn(): Promise<boolean> {
    const credential = this.readCachedCredential();
    if (!credential) return false;
    if (credential.expiresAt && new Date() > credential.expiresAt) {
      return credential.refreshToken !== undefined;
    }
    return true;
  }

  async getStatus(): Promise<{ loggedIn: boolean; email?: string | undefined; plan?: string | undefined }> {
    const credential = this.readCachedCredential();
    if (!credential) return { loggedIn: false };

    const isExpired = credential.expiresAt ? new Date() > credential.expiresAt : false;
    if (isExpired && !credential.refreshToken) return { loggedIn: false };

    return {
      loggedIn: true,
      ...(credential.email !== undefined ? { email: credential.email } : {}),
      plan: "Google AI",
    };
  }

  // ── Read from Gemini CLI cache ────────────────────────────────────────

  private readCachedCredential(): ICredential | undefined {
    const oauthCreds = readOAuthCreds();
    if (!oauthCreds?.access_token) return undefined;

    let email: string | undefined;
    const accounts = readGoogleAccounts();
    if (accounts?.active) {
      email = accounts.active;
    } else if (oauthCreds.id_token) {
      email = extractEmailFromIdToken(oauthCreds.id_token);
    }

    const expiresAt = oauthCreds.expiry_date ? new Date(oauthCreds.expiry_date) : undefined;

    return {
      provider: "google",
      method: "native_login",
      token: oauthCreds.access_token,
      ...(oauthCreds.refresh_token !== undefined ? { refreshToken: oauthCreds.refresh_token } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(email !== undefined ? { email } : {}),
      plan: "Google AI",
    };
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
        reject(new AuthenticationError("google", "Callback server not started"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new AuthenticationError("google", "Login timed out"));
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
          res.end(errorHtml(`Google OAuth error: ${error}`));
          reject(new AuthenticationError("google", `OAuth error: ${error}`));
          return;
        }
        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(errorHtml("State mismatch"));
          reject(new AuthenticationError("google", "OAuth state mismatch"));
          return;
        }
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(errorHtml("Missing authorization code"));
          reject(new AuthenticationError("google", "No authorization code received"));
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
  ): Promise<ICredential> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: codeVerifier,
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new AuthenticationError("google", `Token exchange failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
      scope?: string;
      token_type?: string;
    };

    if (!data.access_token) {
      throw new AuthenticationError("google", "Token exchange returned no access_token");
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined;

    let email: string | undefined;
    if (data.id_token) {
      email = extractEmailFromIdToken(data.id_token);
    }

    // Write tokens in Gemini CLI format so the Gemini CLI can also use them
    const geminiCreds: IGeminiOAuthCreds = {
      access_token: data.access_token,
      ...(data.scope !== undefined ? { scope: data.scope } : {}),
      ...(data.token_type !== undefined ? { token_type: data.token_type } : {}),
      ...(data.id_token !== undefined ? { id_token: data.id_token } : {}),
      ...(expiresAt !== undefined ? { expiry_date: expiresAt.getTime() } : {}),
      ...(data.refresh_token !== undefined ? { refresh_token: data.refresh_token } : {}),
    };
    writeOAuthCreds(geminiCreds);

    if (email) {
      writeGoogleAccounts(email);
    }

    return {
      provider: "google",
      method: "native_login",
      token: data.access_token,
      ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(email !== undefined ? { email } : {}),
      plan: "Google AI",
    };
  }

  private stopServer(): void {
    if (this.callbackServer !== undefined) {
      this.callbackServer.close();
      this.callbackServer = undefined;
    }
  }
}
