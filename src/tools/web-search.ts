/**
 * Web Search tool — search interface (provider-dependent implementation).
 * Per PRD section 5.1
 */

import type { IToolRegistration, PermissionMode } from "../types/tool.js";
import type { IToolResult } from "../types/message.js";
import { logger } from "../utils/logger.js";

type WebSearchProvider = (
  query: string,
  options: { readonly allowedDomains?: readonly string[] | undefined; readonly blockedDomains?: readonly string[] | undefined },
) => Promise<string>;

let searchProvider: WebSearchProvider | undefined;

export function setWebSearchProvider(provider: WebSearchProvider): void {
  searchProvider = provider;
}

export function createWebSearchTool(): IToolRegistration {
  return {
    definition: {
      name: "web_search",
      description:
        "Search the web for up-to-date information. Requires a configured search provider.",
      parameters: [
        {
          name: "query",
          type: "string",
          description: "The search query",
          required: true,
        },
        {
          name: "allowed_domains",
          type: "array",
          description: "Only include results from these domains",
          required: false,
        },
        {
          name: "blocked_domains",
          type: "array",
          description: "Exclude results from these domains",
          required: false,
        },
      ],
    },
    category: "web",
    requiresApproval: (_mode: PermissionMode, _args: Record<string, unknown>): boolean => {
      return false;
    },
    execute: async (args: Record<string, unknown>): Promise<IToolResult> => {
      const query = args["query"];
      if (typeof query !== "string" || query.length === 0) {
        return {
          toolCallId: "",
          name: "web_search",
          content: "query parameter is required and must be a non-empty string.",
          isError: true,
        };
      }

      if (!searchProvider) {
        return {
          toolCallId: "",
          name: "web_search",
          content:
            "Web search is not configured. Set up a search provider in your configuration.",
          isError: true,
        };
      }

      const allowedDomains = Array.isArray(args["allowed_domains"])
        ? (args["allowed_domains"] as unknown[]).filter(
            (d): d is string => typeof d === "string",
          )
        : undefined;

      const blockedDomains = Array.isArray(args["blocked_domains"])
        ? (args["blocked_domains"] as unknown[]).filter(
            (d): d is string => typeof d === "string",
          )
        : undefined;

      try {
        logger.debug({ query }, "Web search executing");

        const results = await searchProvider(query, {
          allowedDomains,
          blockedDomains,
        });

        if (results.length === 0) {
          return {
            toolCallId: "",
            name: "web_search",
            content: `No results found for: ${query}`,
            isError: false,
          };
        }

        return {
          toolCallId: "",
          name: "web_search",
          content: results,
          isError: false,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Search failed";
        logger.error({ query, error: msg }, "Web search failed");

        return {
          toolCallId: "",
          name: "web_search",
          content: `Web search failed: ${msg}`,
          isError: true,
        };
      }
    },
  };
}
