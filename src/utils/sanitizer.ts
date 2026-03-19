/**
 * Input/output sanitization per PRD section 14.2
 * Zero trust for AI output — treat all model-generated content as untrusted
 */

import { isAbsolute, normalize, relative, resolve } from "node:path";

/**
 * Sanitize shell command arguments to prevent injection.
 * PRD REQ: NO shell injection (section 14.1, 15.7 item 10)
 */
export function sanitizeShellArg(arg: string): string {
  // Escape single quotes by replacing them with escaped version
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Validate a file path is within the allowed project root.
 * Prevents directory traversal attacks (PRD section 14.1).
 */
export function validatePath(filePath: string, projectRoot: string): string {
  const normalizedRoot = normalize(resolve(projectRoot));
  const normalizedPath = normalize(resolve(normalizedRoot, filePath));

  if (!isSubPath(normalizedRoot, normalizedPath)) {
    throw new Error(
      `Path traversal detected: "${filePath}" resolves outside project root "${projectRoot}"`,
    );
  }

  return normalizedPath;
}

/**
 * Check if a path is safe (within allowed paths).
 */
export function isPathAllowed(
  filePath: string,
  allowedPaths: readonly string[],
  projectRoot: string,
): boolean {
  const normalizedRoot = normalize(resolve(projectRoot));
  const resolved = normalize(resolve(normalizedRoot, filePath));
  return allowedPaths.some((allowed) => {
    const resolvedAllowed = normalize(resolve(normalizedRoot, allowed));
    return isSubPath(resolvedAllowed, resolved);
  });
}

function isSubPath(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Check if a shell command is on the blocked list.
 * PRD section 14.4: Dangerous commands always require confirmation.
 */
export function isCommandBlocked(
  command: string,
  blockedCommands: readonly string[],
): boolean {
  const normalizedCommand = command.trim().toLowerCase();
  return blockedCommands.some((blocked) =>
    normalizedCommand.includes(blocked.toLowerCase()),
  );
}

/**
 * Redact potential secrets from text for logging.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-ant-api\S+/g, "sk-ant-api[REDACTED]")
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-[REDACTED]")
    .replace(/AIza[a-zA-Z0-9_-]{35}/g, "AIza[REDACTED]")
    .replace(/ghp_[a-zA-Z0-9]{36}/g, "ghp_[REDACTED]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]");
}

/**
 * Sanitize user input for safe inclusion in prompts.
 */
export function sanitizePromptInput(input: string): string {
  // Strip null bytes
  return input.replace(/\0/g, "");
}
