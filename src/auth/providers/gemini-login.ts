/**
 * Gemini (Google) delegated authentication
 * Spawns `gemini login` which opens the browser automatically for Google login.
 * After login, reads cached tokens from ~/.gemini/oauth_creds.json.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ICredential } from "../../types/index.js";
import { AuthenticationError } from "../../types/index.js";
import { CredentialStore } from "../credential-store.js";
import { logger } from "../../utils/index.js";

const execFileAsync = promisify(execFile);

// ── Gemini CLI Token Paths ──────────────────────────────────────────────

const CLI_COMMAND = "gemini";

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

  constructor(store?: CredentialStore) {
    this.credentialStore = store ?? new CredentialStore();
  }

  /**
   * Spawn `gemini login` which opens the browser automatically for Google login,
   * then read the cached tokens from ~/.gemini/oauth_creds.json.
   */
  async login(): Promise<ICredential> {
    // Check if already logged in via cached tokens
    const existing = this.readCachedCredential();
    if (existing) {
      const isExpired = existing.expiresAt ? new Date() > existing.expiresAt : false;
      if (!isExpired) {
        logger.info("Found existing Gemini CLI credentials in ~/.gemini/oauth_creds.json");
        await this.credentialStore.set("google", existing);
        return existing;
      }
    }

    // Check if the CLI is available
    const cliAvailable = await this.isCliAvailable();
    if (!cliAvailable) {
      throw new AuthenticationError(
        "google",
        "Gemini CLI not found. Install it first: npm install -g @anthropic-ai/gemini-cli\n" +
        "Or set an API key: aemeathcli auth set-key gemini <key>",
      );
    }

    // Spawn `gemini login` — browser opens automatically
    logger.info("Spawning gemini login (browser will open automatically)");
    try {
      await this.spawnInteractive(CLI_COMMAND, ["login"]);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new AuthenticationError("google", `Gemini login failed: ${msg}`);
    }

    // Read the freshly cached credentials
    const credential = this.readCachedCredential();
    if (!credential) {
      throw new AuthenticationError(
        "google",
        "No credentials found after Gemini login. Please try again or set an API key: aemeathcli auth set-key gemini <key>",
      );
    }

    await this.credentialStore.set("google", credential);
    logger.info("Gemini credentials imported successfully");
    return credential;
  }

  async logout(): Promise<void> {
    await this.credentialStore.delete("google");
    logger.info("Google session revoked from AemeathCLI");
  }

  async isLoggedIn(): Promise<boolean> {
    const credential = this.readCachedCredential();
    if (!credential) return false;
    if (credential.expiresAt && new Date() > credential.expiresAt && credential.refreshToken === undefined) {
      return false;
    }

    await this.credentialStore.set("google", credential);
    return true;
  }

  async getStatus(): Promise<{ loggedIn: boolean; email?: string | undefined; plan?: string | undefined }> {
    const loggedIn = await this.isLoggedIn();
    if (!loggedIn) return { loggedIn: false };

    const credential = await this.credentialStore.get("google");
    if (!credential) return { loggedIn: false };

    return {
      loggedIn: true,
      ...(credential.email !== undefined ? { email: credential.email } : {}),
      plan: "Google AI",
    };
  }

  async getCachedCredential(): Promise<ICredential | undefined> {
    const credential = this.readCachedCredential();
    if (credential) {
      await this.credentialStore.set("google", credential);
    }
    return credential;
  }

  // ── Internal ──────────────────────────────────────────────────────────

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

  private spawnInteractive(command: string, args: readonly string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { stdio: "inherit", timeout: 300_000 });
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Process exited with code ${String(code)}`));
      });
      child.on("error", reject);
    });
  }

  private async isCliAvailable(): Promise<boolean> {
    try {
      await execFileAsync("which", [CLI_COMMAND], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
