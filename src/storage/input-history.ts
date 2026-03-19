/**
 * Per-project persistent input history across CLI sessions.
 * Stores at ~/.aemeathcli/history/<project-hash>/input-history.json
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getAemeathHome } from "../utils/pathResolver.js";

const HISTORY_FILE = "input-history.json";
const MAX_HISTORY = 500;

const projectCaches = new Map<string, string[]>();

/** Derive a short directory name from a project root path. */
function projectHash(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
}

function getHistoryDir(projectRoot: string): string {
  return join(getAemeathHome(), "history", projectHash(projectRoot));
}

function getHistoryPath(projectRoot: string): string {
  return join(getHistoryDir(projectRoot), HISTORY_FILE);
}

/** Load persistent input history for a specific project. */
export async function loadInputHistory(projectRoot: string): Promise<string[]> {
  const cached = projectCaches.get(projectRoot);
  if (cached !== undefined) return cached;

  try {
    const raw = await readFile(getHistoryPath(projectRoot), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      const history = parsed as string[];
      projectCaches.set(projectRoot, history);
      return history;
    }
  } catch {
    // File doesn't exist yet
  }

  const history: string[] = [];
  projectCaches.set(projectRoot, history);
  return history;
}

/** Append an entry to the project's persistent history and flush to disk. */
export async function appendInputHistory(
  projectRoot: string,
  entry: string,
): Promise<void> {
  let history = projectCaches.get(projectRoot);
  if (!history) {
    history = await loadInputHistory(projectRoot);
  }

  // Deduplicate consecutive
  if (history.length > 0 && history[history.length - 1] === entry) {
    return;
  }

  history.push(entry);

  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  try {
    const dir = getHistoryDir(projectRoot);
    await mkdir(dir, { recursive: true });
    await writeFile(getHistoryPath(projectRoot), JSON.stringify(history), "utf-8");
  } catch {
    // Non-critical
  }
}
