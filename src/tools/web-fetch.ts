/**
 * Web Fetch tool — fetch URL content, strip HTML, timeout handling.
 * Per PRD section 5.1
 */

import type { IToolRegistration, PermissionMode } from "../types/tool.js";
import type { IToolResult } from "../types/message.js";
import { logger } from "../utils/logger.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CONTENT_LENGTH = 100_000;
const MAX_URL_LENGTH = 2048;

function stripHtmlTags(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Replace common block elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  // Collapse excessive whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") {
    return true;
  }
  const ipMatch = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipMatch) {
    const [, a, b] = ipMatch as unknown as [string, string, string, string, string];
    const first = parseInt(a!, 10);
    const second = parseInt(b!, 10);
    if (first === 127) return true;
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
    if (first === 0) return true;
  }
  return false;
}

function isValidUrl(urlString: string): boolean {
  if (urlString.length > MAX_URL_LENGTH) {
    return false;
  }
  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }
    if (isPrivateHostname(url.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function enforceHttps(urlString: string): string {
  try {
    const url = new URL(urlString);
    if (url.protocol === "http:") {
      url.protocol = "https:";
    }
    return url.toString();
  } catch {
    return urlString;
  }
}

export function createWebFetchTool(): IToolRegistration {
  return {
    definition: {
      name: "web_fetch",
      description:
        "Fetch content from a URL and convert HTML to readable text. HTTP URLs are upgraded to HTTPS.",
      parameters: [
        {
          name: "url",
          type: "string",
          description: "The URL to fetch content from",
          required: true,
        },
        {
          name: "prompt",
          type: "string",
          description: "What information to extract from the page",
          required: false,
        },
        {
          name: "timeout",
          type: "number",
          description: "Timeout in milliseconds (default 30000)",
          required: false,
          default: DEFAULT_TIMEOUT_MS,
        },
      ],
    },
    category: "web",
    requiresApproval: (_mode: PermissionMode, _args: Record<string, unknown>): boolean => {
      return false;
    },
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const rawUrl = args["url"];
      if (typeof rawUrl !== "string" || rawUrl.length === 0) {
        return {
          toolCallId: "",
          name: "web_fetch",
          content: "url parameter is required and must be a non-empty string.",
          isError: true,
        };
      }

      if (!isValidUrl(rawUrl)) {
        return {
          toolCallId: "",
          name: "web_fetch",
          content: `Invalid URL: "${rawUrl}". Must be a valid HTTP(S) URL.`,
          isError: true,
        };
      }

      const url = enforceHttps(rawUrl);
      let timeoutMs = DEFAULT_TIMEOUT_MS;
      if (typeof args["timeout"] === "number") {
        timeoutMs = Math.max(5000, Math.min(args["timeout"], 60_000));
      }

      logger.debug({ url, timeout: timeoutMs }, "Fetching URL");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "AemeathCLI/1.0",
            "Accept": "text/html, application/json, text/plain, */*",
          },
          redirect: "follow",
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return {
            toolCallId: "",
            name: "web_fetch",
            content: `HTTP ${response.status} ${response.statusText} for ${url}`,
            isError: true,
          };
        }

        const contentType = response.headers.get("content-type") ?? "";
        const rawBody = await response.text();

        let content: string;
        if (contentType.includes("text/html")) {
          content = stripHtmlTags(rawBody);
        } else {
          content = rawBody;
        }

        if (content.length > MAX_CONTENT_LENGTH) {
          content = content.substring(0, MAX_CONTENT_LENGTH) + "\n...(content truncated)";
        }

        if (content.length === 0) {
          return {
            toolCallId: "",
            name: "web_fetch",
            content: `Fetched ${url} but the response body was empty.`,
            isError: false,
          };
        }

        return {
          toolCallId: "",
          name: "web_fetch",
          content,
          isError: false,
        };
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        if (err instanceof Error && err.name === "AbortError") {
          return {
            toolCallId: "",
            name: "web_fetch",
            content: `Request timed out after ${timeoutMs}ms for ${url}`,
            isError: true,
          };
        }

        const msg = err instanceof Error ? err.message : "Fetch failed";
        logger.error({ url, error: msg }, "Web fetch failed");

        return {
          toolCallId: "",
          name: "web_fetch",
          content: `Fetch failed for ${url}: ${msg}`,
          isError: true,
        };
      }
    },
  };
}
