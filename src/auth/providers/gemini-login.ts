/**
 * Gemini (Google) delegated authentication
 * Reads cached credentials from ~/.gemini/oauth_creds.json (shared with the Gemini CLI).
 * If not authenticated, instructs the user to run `gemini` in a separate terminal
 * since the Gemini CLI has no `login` subcommand and requires interactive terminal consent.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execa } from "execa";
import type { ICredential } from "../../types/index.js";
import { AuthenticationError } from "../../types/index.js";
import { CredentialStore } from "../credential-store.js";
import { logger } from "../../utils/index.js";

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
   * Attempt to import credentials from the Gemini CLI cache.
   * The Gemini CLI has no `login` subcommand and requires interactive terminal
   * consent, so it cannot be spawned from within the TUI. If no credentials
   * are found, instruct the user to run `gemini` in a separate terminal first.
   */
  async login(): Promise<ICredential> {
    // Try importing existing credentials from Gemini CLI's cache
    const existing = this.readCachedCredential();
    if (existing) {
      const isExpired = existing.expiresAt ? new Date() > existing.expiresAt : false;
      if (!isExpired) {
        logger.info("Found existing Gemini CLI credentials in ~/.gemini/oauth_creds.json");
        await this.credentialStore.set("google", existing);
        return existing;
      }
    }

    // Check if the CLI is installed
    const cliAvailable = await this.isCliAvailable();

    if (!cliAvailable) {
      throw new AuthenticationError(
        "google",
        "Gemini CLI not found. Install it first:\n" +
        "  npm install -g @google/gemini-cli\n" +
        "Then run `gemini` in your terminal to authenticate.",
      );
    }

    // Gemini CLI requires interactive terminal consent — cannot be spawned from the TUI.
    throw new AuthenticationError(
      "google",
      "Gemini CLI requires interactive login.\n" +
      "Please run `gemini` in a separate terminal to authenticate first,\n" +
      "then retry /login here to import the credentials.",
    );
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

  private async isCliAvailable(): Promise<boolean> {
    try {
      await execa(CLI_COMMAND, ["--help"], { timeout: 5000, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      return true;
    } catch (error: unknown) {
      // ENOENT means CLI not found; any other error means it exists
      const code = (error as { code?: string }).code;
      return code !== "ENOENT";
    }
  }
}
