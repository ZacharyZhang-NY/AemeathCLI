import { Type } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { IToolDefinition, IToolParameter } from "../types/message.js";
import type { IToolExecutionContext, IToolRegistration } from "../types/tool.js";
import { findProjectRoot } from "../utils/pathResolver.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createGitTool } from "./git.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createReadTool } from "./read.js";
import { createSpawnAgentTool } from "./spawn-agent.js";
import { createWebFetchTool } from "./web-fetch.js";
import { createWebSearchTool } from "./web-search.js";
import { createWriteTool } from "./write.js";
import type { BuildAemeathToolsOptions, ToolCategory } from "./types.js";

function createEnumString(parameter: IToolParameter) {
  const values = parameter.enum ?? [];
  if (values.length === 0) {
    return Type.String({ description: parameter.description });
  }

  return Type.Union(values.map((value) => Type.Literal(value)), {
    description: parameter.description,
  });
}

function parameterToSchema(parameter: IToolParameter) {
  switch (parameter.type) {
    case "number":
      return Type.Number({ description: parameter.description });
    case "boolean":
      return Type.Boolean({ description: parameter.description });
    case "array":
      return Type.Array(Type.String(), { description: parameter.description });
    case "string":
    default:
      return createEnumString(parameter);
  }
}

function definitionToSchema(definition: IToolDefinition) {
  const properties: Record<string, ReturnType<typeof parameterToSchema>> = {};
  for (const parameter of definition.parameters) {
    const schema = parameterToSchema(parameter);
    properties[parameter.name] = parameter.required ? schema : Type.Optional(schema);
  }

  return Type.Object(properties, { additionalProperties: false });
}

function createLegacyContext(options: BuildAemeathToolsOptions): IToolExecutionContext {
  return {
    workingDirectory: options.cwd,
    permissionMode: options.permissionMode,
    projectRoot: options.projectRoot,
    allowedPaths: options.allowedPaths,
    blockedCommands: options.blockedCommands,
  };
}

function adaptLegacyTool(
  registration: IToolRegistration,
  options: BuildAemeathToolsOptions,
  category: ToolCategory,
): ToolDefinition {
  const parameters = definitionToSchema(registration.definition);
  const legacyContext = createLegacyContext(options);

  return defineTool({
    name: registration.definition.name,
    label: registration.definition.name,
    description: registration.definition.description,
    parameters,
    async execute(_toolCallId, params) {
      const normalized = params as Record<string, unknown>;
      if (registration.requiresApproval(legacyContext, normalized)) {
        const approved = await options.onApprovalNeeded(registration.definition.name, normalized);
        if (!approved) {
          throw new Error(`User denied approval for tool "${registration.definition.name}"`);
        }
      }

      const result = await registration.execute(normalized, legacyContext);
      if (result.isError) {
        throw new Error(result.content);
      }

      return {
        content: [{ type: "text", text: result.content }],
        details: { category, toolName: result.name },
      };
    },
  });
}

export function buildAemeathTools(options: BuildAemeathToolsOptions): ToolDefinition[] {
  const projectRoot = findProjectRoot(options.cwd);
  const allowedPaths = options.allowedPaths.length > 0 ? options.allowedPaths : [projectRoot];
  const normalizedOptions: BuildAemeathToolsOptions = {
    ...options,
    projectRoot,
    allowedPaths,
  };

  const tools: ToolDefinition[] = [
    adaptLegacyTool(createReadTool(), normalizedOptions, "file"),
    adaptLegacyTool(createWriteTool(), normalizedOptions, "file"),
    adaptLegacyTool(createEditTool(), normalizedOptions, "file"),
    adaptLegacyTool(createGlobTool(), normalizedOptions, "search"),
    adaptLegacyTool(createGrepTool(), normalizedOptions, "search"),
    adaptLegacyTool(createBashTool(), normalizedOptions, "shell"),
    adaptLegacyTool(createGitTool(), normalizedOptions, "git"),
    adaptLegacyTool(createWebSearchTool(), normalizedOptions, "web"),
    adaptLegacyTool(createWebFetchTool(), normalizedOptions, "web"),
  ];

  if (normalizedOptions.spawnSubagent) {
    tools.push(
      createSpawnAgentTool({
        spawn: (prompt, spawnOptions) => normalizedOptions.spawnSubagent?.(prompt, spawnOptions) ?? Promise.resolve(""),
      }) as unknown as ToolDefinition,
    );
  }

  return tools;
}
