/**
 * Gemini (Google) delegated authentication
 * Reads cached credentials from ~/.gemini/oauth_creds.json (shared with the Gemini CLI).
 * If not authenticated, opens a new terminal window running `gemini` for interactive login,
 * then polls for credentials to appear.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execa } from "execa";
import type { ICredential } from "../../types/index.js";
import { AuthenticationError } from "../../types/index.js";
import { CredentialStore } from "../credential-store.js";
import { logger } from "../../utils/index.js";

// ── Gemini CLI Token Paths ──────────────────────────────────────────────

const CLI_COMMAND = "gemini";
const LOGIN_POLL_INTERVAL_MS = 2_000;
const LOGIN_POLL_TIMEOUT_MS = 120_000;

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

function getCredsMtime(): number {
  const credsPath = getOAuthCredsPath();
  try {
    return statSync(credsPath).mtimeMs;
  } catch {
    return 0;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Open a new terminal window cross-platform ───────────────────────────

async function openTerminalWithGemini(): Promise<void> {
  const platform = process.platform;

  if (platform === "win32") {
    // Windows: open a new PowerShell window running gemini
    await execa("cmd", ["/c", "start", "powershell", "-NoExit", "-Command", "gemini"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
  } else if (platform === "darwin") {
    // macOS: open a new Terminal.app window running gemini
    await execa("osascript", [
      "-e",
      'tell application "Terminal" to do script "gemini"',
      "-e",
      'tell application "Terminal" to activate',
    ], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
  } else {
    // Linux: try common terminal emulators
    const terminals = [
      { cmd: "gnome-terminal", args: ["--", "gemini"] },
      { cmd: "konsole", args: ["-e", "gemini"] },
      { cmd: "xfce4-terminal", args: ["-e", "gemini"] },
      { cmd: "xterm", args: ["-e", "gemini"] },
    ];

    for (const terminal of terminals) {
      try {
        await execa(terminal.cmd, terminal.args, {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          detached: true,
        });
        return;
      } catch {
        // Try next terminal
      }
    }

    throw new Error("Could not find a terminal emulator. Please run `gemini` manually in a separate terminal.");
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
   * If not found, opens a new terminal window running `gemini` for interactive
   * login, then polls for credentials to appear in ~/.gemini/oauth_creds.json.
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
        "Then retry /login.",
      );
    }

    // Record the current mtime so we can detect new credentials
    const beforeMtime = getCredsMtime();

    // Open a new terminal window running gemini for interactive login
    logger.info("Opening new terminal window for Gemini login");
    try {
      await openTerminalWithGemini();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new AuthenticationError("google", msg);
    }

    // Poll for credentials to appear (user authenticates in the other window)
    const credential = await this.pollForCredentials(beforeMtime);
    if (!credential) {
      throw new AuthenticationError(
        "google",
        "Login timed out. Please complete authentication in the Gemini terminal, then retry /login.",
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

  /**
   * Poll for new credentials to appear in ~/.gemini/oauth_creds.json.
   * Detects new credentials by checking if the file mtime changed from beforeMtime.
   */
  private async pollForCredentials(beforeMtime: number): Promise<ICredential | undefined> {
    const deadline = Date.now() + LOGIN_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await sleep(LOGIN_POLL_INTERVAL_MS);

      const currentMtime = getCredsMtime();
      if (currentMtime > beforeMtime) {
        const credential = this.readCachedCredential();
        if (credential) return credential;
      }
    }

    // One final check
    return this.readCachedCredential() ?? undefined;
  }

  private async isCliAvailable(): Promise<boolean> {
    try {
      await execa(CLI_COMMAND, ["--version"], { timeout: 5000, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}
