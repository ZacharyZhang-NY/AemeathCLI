/**
 * Tool Registry — central registry for all built-in and MCP tools.
 * Per PRD sections 5.1, 14.4
 */

import type {
  IToolRegistry,
  IToolRegistration,
  IToolExecutionContext,
  ToolCategory,
} from "../types/tool.js";
import type { IToolDefinition, IToolResult, IToolCall } from "../types/message.js";
import { PermissionDeniedError, ToolCallError } from "../types/errors.js";
import { logger } from "../utils/logger.js";
import { redactSecrets } from "../utils/sanitizer.js";

function redactToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && (key === "content" || key === "command" || key === "new_source")) {
      redacted[key] = redactSecrets(value.length > 200 ? value.slice(0, 200) + "..." : value);
    } else if (typeof value === "string") {
      redacted[key] = redactSecrets(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export class ToolRegistry implements IToolRegistry {
  private readonly tools: Map<string, IToolRegistration> = new Map();
  private readonly categoryIndex: Map<ToolCategory, Set<string>> = new Map();

  register(tool: IToolRegistration): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      logger.warn({ toolName: name }, "Overwriting existing tool registration");
    }
    this.tools.set(name, tool);

    let categorySet = this.categoryIndex.get(tool.category);
    if (!categorySet) {
      categorySet = new Set();
      this.categoryIndex.set(tool.category, categorySet);
    }
    categorySet.add(name);

    logger.debug({ toolName: name, category: tool.category }, "Tool registered");
  }

  get(name: string): IToolRegistration | undefined {
    return this.tools.get(name);
  }

  getAll(): readonly IToolRegistration[] {
    return [...this.tools.values()];
  }

  getDefinitions(): readonly IToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  getByCategory(category: ToolCategory): readonly IToolRegistration[] {
    const names = this.categoryIndex.get(category);
    if (!names) {
      return [];
    }
    const results: IToolRegistration[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) {
        results.push(tool);
      }
    }
    return results;
  }

  async execute(
    call: IToolCall,
    context: IToolExecutionContext,
  ): Promise<IToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: `Unknown tool: ${call.name}`,
        isError: true,
      };
    }

    if (tool.requiresApproval(context.permissionMode, call.arguments)) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: `Tool "${call.name}" requires user approval in ${context.permissionMode} mode.`,
        isError: true,
      };
    }

    try {
      logger.debug({ toolName: call.name, args: redactToolArgs(call.arguments) }, "Executing tool");
      const result = await tool.execute(call.arguments);
      return {
        ...result,
        toolCallId: call.id,
        name: call.name,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown execution error";
      logger.error({ toolName: call.name, error: message }, "Tool execution failed");
      return {
        toolCallId: call.id,
        name: call.name,
        content: message,
        isError: true,
      };
    }
  }
}
