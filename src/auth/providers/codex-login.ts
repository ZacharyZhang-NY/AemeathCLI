/**
 * Codex (OpenAI) delegated authentication
 * Spawns `codex login` which opens the browser automatically for ChatGPT login.
 * After login, reads cached tokens from ~/.codex/auth.json.
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

// ── Codex CLI Token Paths ───────────────────────────────────────────────

const CLI_COMMAND = "codex";

function getCodexHome(): string {
  return process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
}

function getAuthJsonPath(): string {
  return join(getCodexHome(), "auth.json");
}

// ── auth.json Schema ────────────────────────────────────────────────────

interface ICodexAuthJson {
  readonly OPENAI_API_KEY?: string | null;
  readonly tokens?: {
    readonly id_token?: string;
    readonly access_token?: string;
    readonly refresh_token?: string;
    readonly account_id?: string;
  };
  readonly last_refresh?: string;
}

function readCodexAuthJson(): ICodexAuthJson | undefined {
  const authPath = getAuthJsonPath();
  if (!existsSync(authPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(authPath, "utf-8");
    return JSON.parse(raw) as ICodexAuthJson;
  } catch {
    return undefined;
  }
}

function extractEmailFromIdToken(idToken: string): string | undefined {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
    };
    return decoded.email;
  } catch {
    return undefined;
  }
}

// ── CodexLogin Class ────────────────────────────────────────────────────

export class CodexLogin {
  private readonly credentialStore: CredentialStore;

  constructor(store?: CredentialStore) {
    this.credentialStore = store ?? new CredentialStore();
  }

  /**
   * Spawn `codex login` which opens the browser automatically for ChatGPT login,
   * then read the cached tokens from ~/.codex/auth.json.
   */
  async login(): Promise<ICredential> {
    // Check if already logged in via cached tokens
    const existing = this.readCachedCredentials();
    if (existing) {
      logger.info("Found existing Codex credentials in ~/.codex/auth.json");
      await this.credentialStore.set("openai", existing);
      return existing;
    }

    // Check if the CLI is available
    const cliAvailable = await this.isCliAvailable();
    if (!cliAvailable) {
      throw new AuthenticationError(
        "openai",
        "Codex CLI not found. Install it first:\n" +
        "  npm install -g @openai/codex\n" +
        "Or set an API key: aemeathcli auth set-key codex <key>",
      );
    }

    // Spawn `codex login` — browser opens automatically
    logger.info("Spawning codex login (browser will open automatically)");
    try {
      await this.spawnInteractive(CLI_COMMAND, ["login"]);
    } catch (error: unknown) {
      // Try device auth as fallback for headless environments
      try {
        await this.spawnInteractive(CLI_COMMAND, ["login", "--device-auth"]);
      } catch {
        const msg = error instanceof Error ? error.message : String(error);
        throw new AuthenticationError("openai", `Codex login failed: ${msg}`);
      }
    }

    // Read the freshly cached credentials
    const credential = this.readCachedCredentials();
    if (!credential) {
      throw new AuthenticationError(
        "openai",
        "No credentials found after Codex login. Please try again or set an API key: aemeathcli auth set-key codex <key>",
      );
    }

    await this.credentialStore.set("openai", credential);
    logger.info("Codex credentials imported successfully");
    return credential;
  }

  async logout(): Promise<void> {
    await this.credentialStore.delete("openai");
    logger.info("OpenAI session revoked from AemeathCLI");
  }

  async isLoggedIn(): Promise<boolean> {
    const credential = this.readCachedCredentials();
    if (!credential) {
      return false;
    }

    await this.credentialStore.set("openai", credential);
    return true;
  }

  async getStatus(): Promise<{ loggedIn: boolean; email?: string | undefined; plan?: string | undefined }> {
    const loggedIn = await this.isLoggedIn();
    if (!loggedIn) return { loggedIn: false };

    const credential = await this.credentialStore.get("openai");
    if (!credential) return { loggedIn: false };

    return {
      loggedIn: true,
      ...(credential.email !== undefined ? { email: credential.email } : {}),
    };
  }

  async getCachedCredential(): Promise<ICredential | undefined> {
    const credential = this.readCachedCredentials();
    if (credential) {
      await this.credentialStore.set("openai", credential);
    }
    return credential;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private readCachedCredentials(): ICredential | undefined {
    const authData = readCodexAuthJson();
    if (!authData) return undefined;

    if (authData.tokens?.access_token) {
      const email = authData.tokens.id_token
        ? extractEmailFromIdToken(authData.tokens.id_token)
        : undefined;

      return {
        provider: "openai",
        method: "native_login",
        token: authData.tokens.access_token,
        ...(authData.tokens.refresh_token !== undefined ? { refreshToken: authData.tokens.refresh_token } : {}),
        ...(email !== undefined ? { email } : {}),
      };
    }

    if (authData.OPENAI_API_KEY && typeof authData.OPENAI_API_KEY === "string") {
      return {
        provider: "openai",
        method: "api_key",
        token: authData.OPENAI_API_KEY,
      };
    }

    return undefined;
  }

  private spawnInteractive(command: string, args: readonly string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        stdio: "inherit",
        timeout: 300_000,
        shell: process.platform === "win32",
      });
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Process exited with code ${String(code)}`));
      });
      child.on("error", reject);
    });
  }

  private async isCliAvailable(): Promise<boolean> {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      await execFileAsync(cmd, [CLI_COMMAND], {
        timeout: 3000,
        shell: process.platform === "win32",
      });
      return true;
    } catch {
      return false;
    }
  }
}
