/**
 * Grep tool — content search using ripgrep with grep fallback.
 * Per PRD section 5.1
 */

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { IToolRegistration, PermissionMode } from "../types/tool.js";
import type { IToolResult } from "../types/message.js";
import { logger } from "../utils/logger.js";
import { validatePath } from "../utils/sanitizer.js";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_LENGTH = 30_000;
const DEFAULT_HEAD_LIMIT = 0; // unlimited

type OutputMode = "content" | "files_with_matches" | "count";

async function findSearchBinary(): Promise<string> {
  try {
    await execFileAsync("which", ["rg"]);
    return "rg";
  } catch {
    return "grep";
  }
}

function buildRipgrepArgs(
  pattern: string,
  searchPath: string,
  outputMode: OutputMode,
  opts: {
    readonly glob?: string | undefined;
    readonly fileType?: string | undefined;
    readonly contextLines?: number | undefined;
    readonly beforeContext?: number | undefined;
    readonly afterContext?: number | undefined;
    readonly caseInsensitive?: boolean | undefined;
    readonly multiline?: boolean | undefined;
    readonly lineNumbers?: boolean | undefined;
    readonly headLimit?: number | undefined;
  },
): string[] {
  const args: string[] = [];

  if (outputMode === "files_with_matches") {
    args.push("--files-with-matches");
  } else if (outputMode === "count") {
    args.push("--count");
  }

  if (opts.caseInsensitive === true) {
    args.push("-i");
  }

  if (opts.multiline === true) {
    args.push("-U", "--multiline-dotall");
  }

  if (outputMode === "content") {
    if (opts.lineNumbers !== false) {
      args.push("-n");
    }
    if (typeof opts.contextLines === "number" && opts.contextLines > 0) {
      args.push("-C", String(opts.contextLines));
    } else {
      if (typeof opts.beforeContext === "number" && opts.beforeContext > 0) {
        args.push("-B", String(opts.beforeContext));
      }
      if (typeof opts.afterContext === "number" && opts.afterContext > 0) {
        args.push("-A", String(opts.afterContext));
      }
    }
  }

  if (typeof opts.glob === "string" && opts.glob.length > 0) {
    args.push("--glob", opts.glob);
  }

  if (typeof opts.fileType === "string" && opts.fileType.length > 0) {
    args.push("--type", opts.fileType);
  }

  // Always skip common uninteresting directories
  args.push(
    "--glob", "!node_modules",
    "--glob", "!.git",
    "--glob", "!dist",
    "--glob", "!build",
    "--glob", "!coverage",
  );

  args.push("--", pattern, searchPath);

  return args;
}

function buildGrepArgs(
  pattern: string,
  searchPath: string,
  outputMode: OutputMode,
  opts: {
    readonly caseInsensitive?: boolean | undefined;
    readonly contextLines?: number | undefined;
  },
): string[] {
  const args: string[] = ["-r", "--extended-regexp"];

  if (outputMode === "files_with_matches") {
    args.push("-l");
  } else if (outputMode === "count") {
    args.push("-c");
  }

  if (opts.caseInsensitive === true) {
    args.push("-i");
  }

  if (outputMode === "content" && typeof opts.contextLines === "number" && opts.contextLines > 0) {
    args.push("-C", String(opts.contextLines));
  }

  args.push(
    "--exclude-dir=node_modules",
    "--exclude-dir=.git",
    "--exclude-dir=dist",
    "--exclude-dir=build",
  );

  args.push("--", pattern, searchPath);

  return args;
}

function applyLimits(
  output: string,
  headLimit: number,
  offset: number,
): string {
  let lines = output.split("\n");

  if (offset > 0) {
    lines = lines.slice(offset);
  }

  if (headLimit > 0) {
    lines = lines.slice(0, headLimit);
  }

  let result = lines.join("\n");

  if (result.length > MAX_OUTPUT_LENGTH) {
    result = result.substring(0, MAX_OUTPUT_LENGTH) + "\n...(truncated)";
  }

  return result;
}

let projectRoot = process.cwd();

export function setGrepProjectRoot(root: string): void {
  projectRoot = root;
}

export function createGrepTool(): IToolRegistration {
  return {
    definition: {
      name: "grep",
      description:
        "Search file contents using regex patterns. Uses ripgrep (rg) with grep fallback.",
      parameters: [
        {
          name: "pattern",
          type: "string",
          description: "Regular expression pattern to search for",
          required: true,
        },
        {
          name: "path",
          type: "string",
          description: "File or directory to search in. Defaults to project root.",
          required: false,
        },
        {
          name: "output_mode",
          type: "string",
          description: "Output mode: content, files_with_matches, or count",
          required: false,
          default: "files_with_matches",
          enum: ["content", "files_with_matches", "count"],
        },
        {
          name: "glob",
          type: "string",
          description: 'Glob filter for files (e.g. "*.ts")',
          required: false,
        },
        {
          name: "type",
          type: "string",
          description: 'File type filter (e.g. "ts", "py")',
          required: false,
        },
        {
          name: "context",
          type: "number",
          description: "Lines of context around matches",
          required: false,
        },
        {
          name: "-B",
          type: "number",
          description: "Lines of context before matches",
          required: false,
        },
        {
          name: "-A",
          type: "number",
          description: "Lines of context after matches",
          required: false,
        },
        {
          name: "-i",
          type: "boolean",
          description: "Case insensitive search",
          required: false,
          default: false,
        },
        {
          name: "multiline",
          type: "boolean",
          description: "Enable multiline matching",
          required: false,
          default: false,
        },
        {
          name: "head_limit",
          type: "number",
          description: "Limit output to first N entries",
          required: false,
          default: 0,
        },
        {
          name: "offset",
          type: "number",
          description: "Skip first N entries",
          required: false,
          default: 0,
        },
      ],
    },
    category: "search",
    requiresApproval: (_mode: PermissionMode, _args: Record<string, unknown>): boolean => {
      return false;
    },
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const pattern = args["pattern"];
      if (typeof pattern !== "string" || pattern.length === 0) {
        return {
          toolCallId: "",
          name: "grep",
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

      const outputMode: OutputMode =
        args["output_mode"] === "content" || args["output_mode"] === "count"
          ? args["output_mode"]
          : "files_with_matches";

      const headLimit =
        typeof args["head_limit"] === "number" ? args["head_limit"] : DEFAULT_HEAD_LIMIT;
      const offset = typeof args["offset"] === "number" ? args["offset"] : 0;

      const binary = await findSearchBinary();

      const searchArgs =
        binary === "rg"
          ? buildRipgrepArgs(pattern, searchPath, outputMode, {
              glob: typeof args["glob"] === "string" ? args["glob"] : undefined,
              fileType: typeof args["type"] === "string" ? args["type"] : undefined,
              contextLines: typeof args["context"] === "number" ? args["context"] : undefined,
              beforeContext: typeof args["-B"] === "number" ? args["-B"] : undefined,
              afterContext: typeof args["-A"] === "number" ? args["-A"] : undefined,
              caseInsensitive: args["-i"] === true,
              multiline: args["multiline"] === true,
              lineNumbers: true,
              headLimit,
            })
          : buildGrepArgs(pattern, searchPath, outputMode, {
              caseInsensitive: args["-i"] === true,
              contextLines: typeof args["context"] === "number" ? args["context"] : undefined,
            });

      try {
        const { stdout } = await execFileAsync(binary, searchArgs, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30_000,
        });

        const result = applyLimits(stdout.trim(), headLimit, offset);

        if (result.length === 0) {
          return {
            toolCallId: "",
            name: "grep",
            content: "No matches found.",
            isError: false,
          };
        }

        logger.debug({ binary, pattern, outputMode, matches: result.split("\n").length }, "Grep complete");

        return {
          toolCallId: "",
          name: "grep",
          content: result,
          isError: false,
        };
      } catch (err: unknown) {
        // Exit code 1 = no matches (for both rg and grep)
        if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "1") {
          return {
            toolCallId: "",
            name: "grep",
            content: "No matches found.",
            isError: false,
          };
        }

        // ripgrep and grep return exit code 1 for no matches
        const execError = err as { status?: number; stdout?: string };
        if (execError.status === 1) {
          return {
            toolCallId: "",
            name: "grep",
            content: "No matches found.",
            isError: false,
          };
        }

        const msg = err instanceof Error ? err.message : "Search failed";
        logger.error({ binary, pattern, error: msg }, "Grep failed");

        return {
          toolCallId: "",
          name: "grep",
          content: `Search failed: ${msg}`,
          isError: true,
        };
      }
    },
  };
}
