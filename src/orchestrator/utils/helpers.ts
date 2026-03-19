/**
 * Orchestrator utility helpers.
 */

import { randomBytes } from "node:crypto";

/** Non-blocking delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generate a short hex ID (default 4 bytes = 8 hex chars). */
export function generateId(bytes: number = 4): string {
  return randomBytes(bytes).toString("hex");
}

/** Truncate string to max bytes, appending marker if truncated. */
export function truncate(
  text: string,
  maxBytes: number,
  marker: string = "\n[truncated]",
): string {
  if (text.length <= maxBytes) return text;
  return text.slice(0, maxBytes) + marker;
}
