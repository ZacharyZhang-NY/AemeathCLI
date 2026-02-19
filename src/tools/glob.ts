/**
 * Glob tool — fast file pattern matching sorted by modification time.
 * Per PRD section 5.1
 */

import fg from "fast-glob";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { IToolRegistration, PermissionMode } from "../types/tool.js";
import type { IToolResult } from "../types/message.js";
import { logger } from "../utils/logger.js";
import { validatePath } from "../utils/sanitizer.js";

const MAX_RESULTS = 1000;

interface FileEntry {
  readonly path: string;
  readonly mtimeMs: number;
}

let projectRoot = process.cwd();

export function setGlobProjectRoot(root: string): void {
  projectRoot = root;
}

export function createGlobTool(): IToolRegistration {
  return {
    definition: {
      name: "glob",
      description:
        "Find files matching a glob pattern. Results are sorted by modification time (newest first).",
      parameters: [
        {
          name: "pattern",
          type: "string",
          description: 'Glob pattern to match (e.g. "**/*.ts", "src/**/*.tsx")',
          required: true,
        },
        {
          name: "path",
          type: "string",
          description: "Directory to search in. Defaults to project root.",
          required: false,
        },
      ],
    },
    category: "search",
    requiresApproval: (_mode: PermissionMode, _args: Record<string, unknown>): boolean => {
      return false; // Glob never requires approval
    },
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const pattern = args["pattern"];
      if (typeof pattern !== "string" || pattern.length === 0) {
        return {
          toolCallId: "",
          name: "glob",
          content: "pattern parameter is required and must be a non-empty string.",
          isError: true,
        };
      }

      let searchPath: string;
      if (typeof args["path"] === "string" && args["path"].length > 0) {
        const resolved = resolve(projectRoot, args["path"]);
        searchPath = validatePath(resolved, projectRoot);
      } else {
        searchPath = projectRoot;
      }

      let matchedPaths: string[];
      try {
        matchedPaths = await fg(pattern, {
          cwd: searchPath,
          absolute: true,
          dot: false,
          onlyFiles: true,
          ignore: [
            "**/node_modules/**",
            "**/.git/**",
            "**/dist/**",
            "**/build/**",
            "**/.next/**",
            "**/coverage/**",
          ],
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Glob search failed";
        return { toolCallId: "", name: "glob", content: msg, isError: true };
      }

      if (matchedPaths.length === 0) {
        return {
          toolCallId: "",
          name: "glob",
          content: "No files found",
          isError: false,
        };
      }

      // Sort by modification time — newest first
      const entries: FileEntry[] = [];
      for (const filePath of matchedPaths) {
        try {
          const fileStat = await stat(filePath);
          entries.push({ path: filePath, mtimeMs: fileStat.mtimeMs });
        } catch {
          // Skip files we can't stat
        }
      }

      entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

      const truncated = entries.length > MAX_RESULTS;
      const resultEntries = truncated ? entries.slice(0, MAX_RESULTS) : entries;
      const output = resultEntries.map((e) => e.path).join("\n");

      logger.debug(
        { pattern, searchPath, total: entries.length, returned: resultEntries.length },
        "Glob search complete",
      );

      const suffix = truncated
        ? `\n\n(Showing ${MAX_RESULTS} of ${entries.length} matches)`
        : "";

      return {
        toolCallId: "",
        name: "glob",
        content: output + suffix,
        isError: false,
      };
    },
  };
}
