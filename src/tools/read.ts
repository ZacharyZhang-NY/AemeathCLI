/**
 * Read tool — file reading with line numbers, offset/limit, binary detection.
 * Per PRD section 5.1
 */

import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { IToolRegistration, PermissionMode } from "../types/tool.js";
import type { IToolResult } from "../types/message.js";
import { FileNotFoundError } from "../types/errors.js";
import { validatePath } from "../utils/sanitizer.js";
import { logger } from "../utils/logger.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flac",
  ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".sqlite", ".db",
]);

function isBinaryFile(filePath: string, buffer: Buffer): boolean {
  if (BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return true;
  }
  // Check for null bytes in first 8KB
  const sample = buffer.subarray(0, 8192);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      return true;
    }
  }
  return false;
}

function formatWithLineNumbers(
  content: string,
  offset: number,
  limit: number,
): string {
  const allLines = content.split("\n");
  const startLine = Math.max(0, offset);
  const endLine = Math.min(allLines.length, startLine + limit);
  const sliced = allLines.slice(startLine, endLine);

  const maxLineNum = endLine;
  const padWidth = String(maxLineNum).length;

  return sliced
    .map((line, idx) => {
      const lineNum = String(startLine + idx + 1).padStart(padWidth, " ");
      const truncated =
        line.length > MAX_LINE_LENGTH
          ? line.substring(0, MAX_LINE_LENGTH) + "..."
          : line;
      return `${lineNum}\t${truncated}`;
    })
    .join("\n");
}

let projectRoot = process.cwd();

export function setReadProjectRoot(root: string): void {
  projectRoot = root;
}

export function createReadTool(): IToolRegistration {
  return {
    definition: {
      name: "read",
      description:
        "Read a file from the filesystem with line numbers. Supports offset and limit for large files.",
      parameters: [
        {
          name: "file_path",
          type: "string",
          description: "Absolute path to the file to read",
          required: true,
        },
        {
          name: "offset",
          type: "number",
          description: "Line number to start reading from (0-indexed)",
          required: false,
          default: 0,
        },
        {
          name: "limit",
          type: "number",
          description: "Maximum number of lines to read",
          required: false,
          default: DEFAULT_LINE_LIMIT,
        },
      ],
    },
    category: "file",
    requiresApproval: (_mode: PermissionMode, _args: Record<string, unknown>): boolean => {
      return false; // Read never requires approval
    },
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const filePath = args["file_path"];
      if (typeof filePath !== "string" || filePath.length === 0) {
        return {
          toolCallId: "",
          name: "read",
          content: "file_path parameter is required and must be a non-empty string.",
          isError: true,
        };
      }

      let resolvedPath: string;
      try {
        resolvedPath = validatePath(filePath, projectRoot);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Path validation failed";
        return { toolCallId: "", name: "read", content: msg, isError: true };
      }

      let fileStat;
      try {
        fileStat = await stat(resolvedPath);
      } catch {
        throw new FileNotFoundError(resolvedPath);
      }

      if (!fileStat.isFile()) {
        return {
          toolCallId: "",
          name: "read",
          content: `"${resolvedPath}" is not a regular file. Use Bash ls to list directories.`,
          isError: true,
        };
      }

      if (fileStat.size > MAX_FILE_SIZE) {
        return {
          toolCallId: "",
          name: "read",
          content: `File is too large (${(fileStat.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
          isError: true,
        };
      }

      const rawBuffer = await readFile(resolvedPath);

      if (isBinaryFile(resolvedPath, rawBuffer)) {
        return {
          toolCallId: "",
          name: "read",
          content: `Binary file detected: ${resolvedPath} (${fileStat.size} bytes). Cannot display binary content.`,
          isError: false,
        };
      }

      const content = rawBuffer.toString("utf-8");

      if (content.length === 0) {
        return {
          toolCallId: "",
          name: "read",
          content: `File "${resolvedPath}" exists but is empty.`,
          isError: false,
        };
      }

      const offset = typeof args["offset"] === "number" ? args["offset"] : 0;
      const limit = typeof args["limit"] === "number" ? args["limit"] : DEFAULT_LINE_LIMIT;

      const formatted = formatWithLineNumbers(content, offset, limit);
      logger.debug({ file: resolvedPath, offset, limit }, "File read");

      return {
        toolCallId: "",
        name: "read",
        content: formatted,
        isError: false,
      };
    },
  };
}
