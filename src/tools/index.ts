/**
 * Tools barrel export and default registry factory.
 * Per PRD section 5.1
 */

export { ToolRegistry } from "./registry.js";

export { createReadTool } from "./read.js";
export { createWriteTool } from "./write.js";
export { createEditTool } from "./edit.js";
export { createGlobTool } from "./glob.js";
export { createGrepTool } from "./grep.js";
export { createBashTool } from "./bash.js";
export { createWebSearchTool, setWebSearchProvider } from "./web-search.js";
export { createWebFetchTool } from "./web-fetch.js";
export { createGitTool } from "./git.js";

import { ToolRegistry } from "./registry.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
import { createEditTool } from "./edit.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createBashTool } from "./bash.js";
import { createWebSearchTool } from "./web-search.js";
import { createWebFetchTool } from "./web-fetch.js";
import { createGitTool } from "./git.js";
import type { IToolExecutionContext } from "../types/tool.js";

export function createDefaultRegistry(_context: IToolExecutionContext): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(createReadTool());
  registry.register(createWriteTool());
  registry.register(createEditTool());
  registry.register(createGlobTool());
  registry.register(createGrepTool());
  registry.register(createBashTool());
  registry.register(createWebSearchTool());
  registry.register(createWebFetchTool());
  registry.register(createGitTool());

  return registry;
}
