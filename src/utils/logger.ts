/**
 * Structured logging via pino per PRD section 16.1
 * Automatic credential redaction per PRD section 14.1
 */

import pino from "pino";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const LOG_DIR = join(homedir(), ".aemeathcli", "logs");

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  } catch {
    // Log dir creation failed — fall back to stderr only
  }
}

// Redaction patterns for credentials (PRD section 14.2 REQ-CRED-04)
const REDACT_PATHS = [
  "token",
  "refreshToken",
  "apiKey",
  "accessToken",
  "sessionToken",
  "password",
  "secret",
  "authorization",
  "cookie",
  "*.token",
  "*.refreshToken",
  "*.apiKey",
  "*.accessToken",
  "*.sessionToken",
  "*.password",
  "*.secret",
];

ensureLogDir();

const logger = pino({
  name: "aemeathcli",
  level: process.env["AEMEATHCLI_LOG_LEVEL"] ?? "error",
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  ...(process.env["NODE_ENV"] === "development"
    ? {
        transport: {
          target: "pino/file",
          options: { destination: join(LOG_DIR, "aemeathcli.log"), mkdir: true },
        },
      }
    : {}),
  timestamp: pino.stdTimeFunctions.isoTime,
});

export { logger };
