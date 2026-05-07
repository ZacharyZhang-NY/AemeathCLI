/**
 * Tools barrel export and pi-backed tool builder.
 */

export { createReadTool } from "./read.js";
export { createWriteTool } from "./write.js";
export { createEditTool } from "./edit.js";
export { createGlobTool } from "./glob.js";
export { createGrepTool } from "./grep.js";
export { createBashTool } from "./bash.js";
export { createWebSearchTool, setWebSearchProvider } from "./web-search.js";
export { createWebFetchTool } from "./web-fetch.js";
export { createGitTool } from "./git.js";
export { createSpawnAgentTool } from "./spawn-agent.js";

export type { AemeathTool, AemeathToolContext, BuildAemeathToolsOptions, ToolCategory } from "./types.js";
export { buildAemeathTools } from "./registry.js";
