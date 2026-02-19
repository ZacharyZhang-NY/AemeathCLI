/**
 * Safe path handling per PRD section 15.7 item 5
 * NO hardcoded paths — use path.join(), os.homedir(), XDG Base Directory
 */

import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// ── XDG-inspired directory layout ────────────────────────────────────────

const AEMEATHCLI_HOME = join(homedir(), ".aemeathcli");

export function getAemeathHome(): string {
  return process.env["AEMEATHCLI_HOME"] ?? AEMEATHCLI_HOME;
}

export function getConfigDir(): string {
  return getAemeathHome();
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function getDatabaseDir(): string {
  return join(getAemeathHome(), "db");
}

export function getDatabasePath(): string {
  return join(getDatabaseDir(), "aemeathcli.db");
}

export function getLogDir(): string {
  return join(getAemeathHome(), "logs");
}

export function getCredentialsPath(): string {
  return join(getAemeathHome(), "credentials.enc");
}

export function getMCPConfigPath(): string {
  return join(getAemeathHome(), "mcp.json");
}

export function getUserSkillsDir(): string {
  return join(getAemeathHome(), "skills");
}

export function getTeamsDir(): string {
  return join(getAemeathHome(), "teams");
}

export function getTasksDir(): string {
  return join(getAemeathHome(), "tasks");
}

// ── Project-level paths ──────────────────────────────────────────────────

export function getProjectConfigDir(projectRoot: string): string {
  return join(projectRoot, ".aemeathcli");
}

export function getProjectConfigPath(projectRoot: string): string {
  return join(getProjectConfigDir(projectRoot), "config.json");
}

export function getProjectSkillsDir(projectRoot: string): string {
  return join(getProjectConfigDir(projectRoot), "skills");
}

export function getProjectMCPConfigPath(projectRoot: string): string {
  return join(getProjectConfigDir(projectRoot), "mcp.json");
}

export function getProjectAgentsPath(projectRoot: string): string {
  return join(getProjectConfigDir(projectRoot), "AGENTS.md");
}

// ── Socket paths (PRD section 14.5) ──────────────────────────────────────

export function getIPCSocketDir(): string {
  const tmpDir = process.env["TMPDIR"] ?? "/tmp";
  return join(tmpDir, `aemeathcli-${process.getuid?.() ?? "user"}`);
}

export function getIPCSocketPath(sessionId: string): string {
  return join(getIPCSocketDir(), `${sessionId}.sock`);
}

// ── Directory Initialization ─────────────────────────────────────────────

export function ensureDirectory(dirPath: string, mode?: number): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: mode ?? 0o755 });
  }
}

export function ensureSecureDirectory(dirPath: string): void {
  ensureDirectory(dirPath, 0o700);
}

export function initializeDirectories(): void {
  ensureSecureDirectory(getAemeathHome());
  ensureDirectory(getDatabaseDir());
  ensureSecureDirectory(getLogDir());
  ensureDirectory(getUserSkillsDir());
  ensureDirectory(getTeamsDir());
  ensureDirectory(getTasksDir());
}

// ── Project Root Detection ───────────────────────────────────────────────

export function findProjectRoot(startDir?: string): string {
  let currentDir = startDir ?? process.cwd();

  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, ".git"))) {
      return currentDir;
    }
    if (existsSync(join(currentDir, ".aemeathcli"))) {
      return currentDir;
    }
    if (existsSync(join(currentDir, "package.json"))) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  // Fallback to cwd
  return process.cwd();
}
