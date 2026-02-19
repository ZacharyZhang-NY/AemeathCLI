/**
 * Edit tool — exact string replacement with uniqueness validation.
 * Per PRD section 5.1
 */

import { readFile, writeFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import type { IToolRegistration, PermissionMode } from "../types/tool.js";
import type { IToolResult } from "../types/message.js";
import { FileNotFoundError } from "../types/errors.js";
import { validatePath } from "../utils/sanitizer.js";
import { logger } from "../utils/logger.js";

let projectRoot = process.cwd();

export function setEditProjectRoot(root: string): void {
  projectRoot = root;
}

export function createEditTool(): IToolRegistration {
  return {
    definition: {
      name: "edit",
      description:
        "Perform exact string replacement in a file. The old_string must be unique unless replace_all is true.",
      parameters: [
        {
          name: "file_path",
          type: "string",
          description: "Absolute path to the file to edit",
          required: true,
        },
        {
          name: "old_string",
          type: "string",
          description: "The exact text to find and replace",
          required: true,
        },
        {
          name: "new_string",
          type: "string",
          description: "The replacement text",
          required: true,
        },
        {
          name: "replace_all",
          type: "boolean",
          description: "Replace all occurrences instead of requiring uniqueness",
          required: false,
          default: false,
        },
      ],
    },
    category: "file",
    requiresApproval: (mode: PermissionMode, _args: Record<string, unknown>): boolean => {
      return mode === "strict" || mode === "standard";
    },
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const filePath = args["file_path"];
      const oldString = args["old_string"];
      const newString = args["new_string"];
      const replaceAll = args["replace_all"] === true;

      if (typeof filePath !== "string" || filePath.length === 0) {
        return {
          toolCallId: "",
          name: "edit",
          content: "file_path parameter is required and must be a non-empty string.",
          isError: true,
        };
      }

      if (typeof oldString !== "string") {
        return {
          toolCallId: "",
          name: "edit",
          content: "old_string parameter is required and must be a string.",
          isError: true,
        };
      }

      if (typeof newString !== "string") {
        return {
          toolCallId: "",
          name: "edit",
          content: "new_string parameter is required and must be a string.",
          isError: true,
        };
      }

      if (oldString === newString) {
        return {
          toolCallId: "",
          name: "edit",
          content: "old_string and new_string are identical — no edit needed.",
          isError: true,
        };
      }

      let resolvedPath: string;
      try {
        resolvedPath = validatePath(filePath, projectRoot);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Path validation failed";
        return { toolCallId: "", name: "edit", content: msg, isError: true };
      }

      try {
        const fileStat = await stat(resolvedPath);
        if (!fileStat.isFile()) {
          return {
            toolCallId: "",
            name: "edit",
            content: `"${resolvedPath}" is not a regular file.`,
            isError: true,
          };
        }
      } catch {
        throw new FileNotFoundError(resolvedPath);
      }

      const rawBuffer = await readFile(resolvedPath);
      const originalContent = rawBuffer.toString("utf-8");

      if (!originalContent.includes(oldString)) {
        return {
          toolCallId: "",
          name: "edit",
          content:
            `old_string not found in ${resolvedPath}. Ensure it matches the file content exactly, including whitespace and indentation.`,
          isError: true,
        };
      }

      if (!replaceAll) {
        const firstIdx = originalContent.indexOf(oldString);
        const secondIdx = originalContent.indexOf(oldString, firstIdx + 1);
        if (secondIdx !== -1) {
          const occurrences = originalContent.split(oldString).length - 1;
          return {
            toolCallId: "",
            name: "edit",
            content:
              `old_string is not unique — found ${occurrences} occurrences in ${resolvedPath}. ` +
              `Provide more surrounding context to make it unique, or set replace_all to true.`,
            isError: true,
          };
        }
      }

      let newContent: string;
      let replacementCount: number;

      if (replaceAll) {
        replacementCount = originalContent.split(oldString).length - 1;
        newContent = originalContent.split(oldString).join(newString);
      } else {
        replacementCount = 1;
        const idx = originalContent.indexOf(oldString);
        newContent =
          originalContent.substring(0, idx) +
          newString +
          originalContent.substring(idx + oldString.length);
      }

      await writeFile(resolvedPath, newContent, "utf-8");

      logger.debug(
        { file: resolvedPath, replacements: replacementCount },
        "File edited",
      );

      return {
        toolCallId: "",
        name: "edit",
        content: `Edited ${resolvedPath}: ${replacementCount} replacement(s) made.`,
        isError: false,
      };
    },
  };
}
