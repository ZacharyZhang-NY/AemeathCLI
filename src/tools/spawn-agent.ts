import { Type } from "@mariozechner/pi-ai";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export interface SpawnAgentToolOptions {
  spawn: (prompt: string, options?: { model?: string | undefined; role?: string | undefined }) => Promise<string>;
}

const SpawnAgentParameters = Type.Object({
  description: Type.String({ description: "Short description of the delegated task" }),
  prompt: Type.String({ description: "Full prompt to execute in the subagent" }),
  model: Type.Optional(Type.String({ description: "Optional model override for the subagent" })),
  role: Type.Optional(Type.String({ description: "Optional role override for the subagent" })),
});

export function createSpawnAgentTool(options: SpawnAgentToolOptions): ToolDefinition<typeof SpawnAgentParameters, { delegated: true }> {
  return defineTool({
    name: "Task",
    label: "Task",
    description: "Delegate a complex task to a child agent session and return its final result.",
    promptSnippet: "Task(description, prompt, model?, role?) — run a subagent when the job is too large for one turn.",
    parameters: SpawnAgentParameters,
    async execute(_toolCallId, params) {
      const spawnArguments: { model?: string | undefined; role?: string | undefined } = {};
      if (params.model !== undefined) {
        spawnArguments.model = params.model;
      }
      if (params.role !== undefined) {
        spawnArguments.role = params.role;
      }
      const text = await options.spawn(params.prompt, spawnArguments);
      return {
        content: [{ type: "text", text }],
        details: { delegated: true },
      };
    },
  });
}
