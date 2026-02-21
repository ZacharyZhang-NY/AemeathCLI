/**
 * Kimi (Moonshot) delegated authentication
 * Reads cached credentials from Kimi CLI's ~/.kimi/credentials/kimi-code.json.
 * If not found, spawns `kimi` CLI for interactive login.
 * Kimi's login opens a browser automatically from its interactive session.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execa } from "execa";
import type { ICredential } from "../../types/index.js";
import { AuthenticationError } from "../../types/index.js";
import { CredentialStore } from "../credential-store.js";
import { logger } from "../../utils/index.js";

// ── Kimi CLI Token Paths ────────────────────────────────────────────────

const CLI_COMMAND = "kimi";

function getKimiHome(): string {
  return process.env["KIMI_HOME"] ?? join(homedir(), ".kimi");
}

function getCredentialsPath(): string {
  return join(getKimiHome(), "credentials", "kimi-code.json");
}

// ── kimi-code.json Schema ───────────────────────────────────────────────

interface IKimiCredentials {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_at?: number;
  readonly scope?: string;
  readonly token_type?: string;
}

function readKimiCredentials(): IKimiCredentials | undefined {
  const credsPath = getCredentialsPath();
  if (!existsSync(credsPath)) return undefined;
  try {
    return JSON.parse(readFileSync(credsPath, "utf-8")) as IKimiCredentials;
  } catch {
    return undefined;
  }
}

// ── KimiLogin Class ─────────────────────────────────────────────────────

export class KimiLogin {
  private readonly credentialStore: CredentialStore;

  constructor(store?: CredentialStore) {
    this.credentialStore = store ?? new CredentialStore();
  }

  /**
   * Login via the Kimi CLI.
   * First checks for cached credentials. If not found, spawns the Kimi CLI
   * interactive session which handles browser-based login automatically.
   */
  async login(): Promise<ICredential> {
    // Check if already logged in via cached tokens
    const existing = this.readCachedCredentials();
    if (existing) {
      logger.info("Found existing Kimi CLI credentials");
      await this.credentialStore.set("kimi", existing);
      return existing;
    }

    // Check if the CLI is available
    const cliAvailable = await this.isCliAvailable();
    if (!cliAvailable) {
      throw new AuthenticationError(
        "kimi",
        "Kimi CLI not found. Install it first:\n" +
        (process.platform === "win32"
          ? "  irm https://code.kimi.com/install.ps1 | iex\n"
          : "  curl -L code.kimi.com/install.sh | bash\n") +
        "Or set an API key: aemeathcli auth set-key kimi <key>",
      );
    }

    // Spawn kimi CLI — it handles login with browser automatically
    logger.info("Spawning Kimi CLI for login (browser will open automatically)");
    try {
      await this.spawnInteractive(CLI_COMMAND, ["login"]);
    } catch {
      // Some versions may not have `kimi login` — try spawning interactive session
      try {
        await this.spawnInteractive(CLI_COMMAND, []);
      } catch (error2: unknown) {
        const msg = error2 instanceof Error ? error2.message : String(error2);
        throw new AuthenticationError("kimi", `Kimi login failed: ${msg}`);
      }
    }

    // Read the freshly cached credentials
    const credential = this.readCachedCredentials();
    if (!credential) {
      throw new AuthenticationError(
        "kimi",
        "No Kimi credentials found after login. Please try again or set an API key: aemeathcli auth set-key kimi <key>",
      );
    }

    await this.credentialStore.set("kimi", credential);
    logger.info("Kimi credentials imported successfully");
    return credential;
  }

  async logout(): Promise<void> {
    await this.credentialStore.delete("kimi");
    logger.info("Kimi session revoked from AemeathCLI");
  }

  async isLoggedIn(): Promise<boolean> {
    const credential = this.readCachedCredentials();
    if (!credential) {
      return false;
    }

    await this.credentialStore.set("kimi", credential);
    return true;
  }

  async getStatus(): Promise<{ loggedIn: boolean; email?: string | undefined; plan?: string | undefined }> {
    const loggedIn = await this.isLoggedIn();
    if (!loggedIn) return { loggedIn: false };

    const credential = await this.credentialStore.get("kimi");
    if (!credential) return { loggedIn: false };

    return {
      loggedIn: true,
      ...(credential.email !== undefined ? { email: credential.email } : {}),
    };
  }

  async getCachedCredential(): Promise<ICredential | undefined> {
    const credential = this.readCachedCredentials();
    if (credential) {
      await this.credentialStore.set("kimi", credential);
    }
    return credential;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private readCachedCredentials(): ICredential | undefined {
    const kimiCreds = readKimiCredentials();
    if (!kimiCreds?.access_token) return undefined;

    // Check expiry (expires_at is seconds since epoch)
    if (kimiCreds.expires_at) {
      const expiresAt = new Date(kimiCreds.expires_at * 1000);
      if (new Date() > expiresAt && !kimiCreds.refresh_token) {
        logger.debug("Kimi CLI token expired with no refresh token");
        return undefined;
      }
    }

    const expiresAt = kimiCreds.expires_at
      ? new Date(kimiCreds.expires_at * 1000)
      : undefined;

    return {
      provider: "kimi",
      method: "native_login",
      token: kimiCreds.access_token,
      ...(kimiCreds.refresh_token !== undefined ? { refreshToken: kimiCreds.refresh_token } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
  }

  private async spawnInteractive(command: string, args: readonly string[]): Promise<void> {
    await execa(command, [...args], { stdio: "inherit", timeout: 300_000 });
  }

  private async isCliAvailable(): Promise<boolean> {
    try {
      await execa(CLI_COMMAND, ["--help"], { timeout: 5000, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      return true;
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      return code !== "ENOENT";
    }
  }
}
