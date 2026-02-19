/**
 * Credential storage per PRD section 13.6
 * Primary: OS keychain via node-keytar
 * Fallback: AES-256-GCM encrypted file
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import type { ProviderName, ICredential } from "../types/index.js";
import { getCredentialsPath, ensureSecureDirectory, getAemeathHome } from "../utils/index.js";
import { logger } from "../utils/index.js";

const SERVICE_PREFIX = "com.aemeathcli";
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

function getServiceName(provider: ProviderName): string {
  return `${SERVICE_PREFIX}.${provider}`;
}

export class CredentialStore {
  private keytarAvailable: boolean | undefined;

  /**
   * Store a credential for a provider.
   */
  async set(provider: ProviderName, credential: ICredential): Promise<void> {
    const data = JSON.stringify(credential);
    const service = getServiceName(provider);

    if (await this.isKeytarAvailable()) {
      try {
        const keytar = await this.getKeytar();
        await keytar.setPassword(service, provider, data);
        logger.info({ provider }, "Credential stored in OS keychain");
        return;
      } catch (error: unknown) {
        logger.warn({ provider }, "OS keychain store failed, using encrypted fallback");
      }
    }

    // Fallback: encrypted file
    this.storeEncrypted(provider, data);
  }

  /**
   * Get a credential for a provider.
   */
  async get(provider: ProviderName): Promise<ICredential | undefined> {
    const service = getServiceName(provider);

    if (await this.isKeytarAvailable()) {
      try {
        const keytar = await this.getKeytar();
        const data = await keytar.getPassword(service, provider);
        if (data) {
          return JSON.parse(data) as ICredential;
        }
      } catch {
        // Try fallback
      }
    }

    // Fallback: encrypted file
    return this.loadEncrypted(provider);
  }

  /**
   * Delete a credential for a provider.
   */
  async delete(provider: ProviderName): Promise<void> {
    const service = getServiceName(provider);

    if (await this.isKeytarAvailable()) {
      try {
        const keytar = await this.getKeytar();
        await keytar.deletePassword(service, provider);
      } catch {
        // Ignore
      }
    }

    // Also clean fallback
    this.deleteEncrypted(provider);
  }

  /**
   * Check if a credential exists for a provider.
   */
  async has(provider: ProviderName): Promise<boolean> {
    const credential = await this.get(provider);
    return credential !== undefined;
  }

  // ── Encrypted File Fallback ────────────────────────────────────────────

  private getEncryptionKey(salt: Buffer): Buffer {
    // Derive key from machine-specific data + random salt using scrypt with high cost
    const machineId = process.env["USER"] ?? process.env["USERNAME"] ?? "aemeathcli";
    const homedir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "/";
    const password = `aemeathcli-${machineId}-${homedir}`;
    return scryptSync(password, salt, KEY_LENGTH, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  }

  private storeEncrypted(provider: ProviderName, data: string): void {
    const credPath = getCredentialsPath();
    ensureSecureDirectory(getAemeathHome());

    let store: Record<string, string> = {};
    if (existsSync(credPath)) {
      try {
        const existing = this.decryptFile(credPath);
        store = JSON.parse(existing) as Record<string, string>;
      } catch {
        store = {};
      }
    }

    store[provider] = data;
    this.encryptFile(credPath, JSON.stringify(store));
    chmodSync(credPath, 0o600);
    logger.info({ provider }, "Credential stored in encrypted fallback");
  }

  private loadEncrypted(provider: ProviderName): ICredential | undefined {
    const credPath = getCredentialsPath();
    if (!existsSync(credPath)) {
      return undefined;
    }

    try {
      const content = this.decryptFile(credPath);
      const store = JSON.parse(content) as Record<string, string>;
      const data = store[provider];
      if (data) {
        return JSON.parse(data) as ICredential;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private deleteEncrypted(provider: ProviderName): void {
    const credPath = getCredentialsPath();
    if (!existsSync(credPath)) {
      return;
    }

    try {
      const content = this.decryptFile(credPath);
      const store = JSON.parse(content) as Record<string, string>;
      delete store[provider];
      this.encryptFile(credPath, JSON.stringify(store));
    } catch {
      // Ignore
    }
  }

  private encryptFile(filePath: string, plaintext: string): void {
    const salt = randomBytes(SALT_LENGTH);
    const key = this.getEncryptionKey(salt);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: salt(32) + iv(16) + tag(16) + encrypted
    const output = Buffer.concat([salt, iv, tag, encrypted]);
    writeFileSync(filePath, output);
  }

  private decryptFile(filePath: string): string {
    const fileContent = readFileSync(filePath);

    // Handle legacy format without salt (iv(16) + tag(16) + encrypted)
    const hasStoredSalt = fileContent.length > SALT_LENGTH + IV_LENGTH + TAG_LENGTH;
    let salt: Buffer;
    let dataOffset: number;

    if (hasStoredSalt) {
      salt = fileContent.subarray(0, SALT_LENGTH);
      dataOffset = SALT_LENGTH;
    } else {
      // Legacy fallback: derive salt from username (for backward compatibility)
      const machineId = process.env["USER"] ?? process.env["USERNAME"] ?? "aemeathcli";
      salt = Buffer.from(`aemeathcli-${machineId}`.padEnd(SALT_LENGTH, "\0").slice(0, SALT_LENGTH));
      dataOffset = 0;
    }

    const key = this.getEncryptionKey(salt);
    const iv = fileContent.subarray(dataOffset, dataOffset + IV_LENGTH);
    const tag = fileContent.subarray(dataOffset + IV_LENGTH, dataOffset + IV_LENGTH + TAG_LENGTH);
    const encrypted = fileContent.subarray(dataOffset + IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return decrypted.toString("utf-8");
  }

  // ── Keytar Detection ───────────────────────────────────────────────────

  private async isKeytarAvailable(): Promise<boolean> {
    if (this.keytarAvailable !== undefined) {
      return this.keytarAvailable;
    }

    try {
      await import("keytar");
      this.keytarAvailable = true;
    } catch {
      this.keytarAvailable = false;
    }

    return this.keytarAvailable;
  }

  private async getKeytar(): Promise<typeof import("keytar")> {
    return import("keytar");
  }
}
