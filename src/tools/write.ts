/**
 * Write tool — write content to files, create parent dirs, set permissions.
 * Per PRD section 5.1
 */

import { writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type { IToolRegistration, PermissionMode } from "../types/tool.js";
import type { IToolResult } from "../types/message.js";
import { validatePath } from "../utils/sanitizer.js";
import { logger } from "../utils/logger.js";

const CONFIG_EXTENSIONS = new Set([
  ".env", ".pem", ".key", ".crt", ".p12", ".pfx", ".jks",
]);

const SENSITIVE_FILENAMES = new Set([
  ".env", ".env.local", ".env.production", ".env.development",
  "credentials.json", "credentials.enc", "secrets.json",
  "id_rsa", "id_ed25519", "config.json",
]);

function isConfigFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  const base = filePath.split("/").pop() ?? "";
  return CONFIG_EXTENSIONS.has(ext) || SENSITIVE_FILENAMES.has(base);
}

let projectRoot = process.cwd();

export function setWriteProjectRoot(root: string): void {
  projectRoot = root;
}

export function createWriteTool(): IToolRegistration {
  return {
    definition: {
      name: "write",
      description:
        "Write content to a file. Creates parent directories if needed. Overwrites existing files.",
      parameters: [
        {
          name: "file_path",
          type: "string",
          description: "Absolute path to the file to write",
          required: true,
        },
        {
          name: "content",
          type: "string",
          description: "The content to write to the file",
          required: true,
        },
      ],
    },
    category: "file",
    requiresApproval: (mode: PermissionMode, _args: Record<string, unknown>): boolean => {
      // Write always requires approval in strict and standard modes
      return mode === "strict" || mode === "standard";
    },
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const filePath = args["file_path"];
      const content = args["content"];

      if (typeof filePath !== "string" || filePath.length === 0) {
        return {
          toolCallId: "",
          name: "write",
          content: "file_path parameter is required and must be a non-empty string.",
          isError: true,
        };
      }

      if (typeof content !== "string") {
        return {
          toolCallId: "",
          name: "write",
          content: "content parameter is required and must be a string.",
          isError: true,
        };
      }

      let resolvedPath: string;
      try {
        resolvedPath = validatePath(filePath, projectRoot);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Path validation failed";
        return { toolCallId: "", name: "write", content: msg, isError: true };
      }

      const parentDir = dirname(resolvedPath);
      try {
        await mkdir(parentDir, { recursive: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to create directory";
        return {
          toolCallId: "",
          name: "write",
          content: `Failed to create parent directory: ${msg}`,
          isError: true,
        };
      }

      const fileMode = isConfigFile(resolvedPath) ? 0o600 : 0o644;

      let existed = false;
      try {
        const fileStat = await stat(resolvedPath);
        existed = fileStat.isFile();
      } catch {
        // File does not exist — will be created
      }

      try {
        await writeFile(resolvedPath, content, { encoding: "utf-8", mode: fileMode });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Write failed";
        return {
          toolCallId: "",
          name: "write",
          content: `Failed to write file: ${msg}`,
          isError: true,
        };
      }

      const lineCount = content.split("\n").length;
      const action = existed ? "Updated" : "Created";

      logger.debug(
        { file: resolvedPath, lines: lineCount, mode: fileMode.toString(8) },
        `File ${action.toLowerCase()}`,
      );

      return {
        toolCallId: "",
        name: "write",
        content: `${action} ${resolvedPath} (${lineCount} lines)`,
        isError: false,
      };
    },
  };
}
