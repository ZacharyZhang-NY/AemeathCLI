/**
 * UI utility functions
 */

import { randomUUID } from "node:crypto";

/**
 * Generate a unique ID for messages and other UI elements.
 */
export function v4Id(): string {
  return randomUUID();
}
