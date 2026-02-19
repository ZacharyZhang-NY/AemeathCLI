/**
 * Tools barrel export and default registry factory.
 * Per PRD section 5.1
 */

export { ToolRegistry } from "./registry.js";

export { createReadTool, setReadProjectRoot } from "./read.js";
export { createWriteTool, setWriteProjectRoot } from "./write.js";
export { createEditTool, setEditProjectRoot } from "./edit.js";
export { createGlobTool, setGlobProjectRoot } from "./glob.js";
export { createGrepTool, setGrepProjectRoot } from "./grep.js";
export { createBashTool, setBashWorkingDirectory, setBashBlockedCommands } from "./bash.js";
export { createWebSearchTool, setWebSearchProvider } from "./web-search.js";
export { createWebFetchTool } from "./web-fetch.js";
export { createGitTool, setGitWorkingDirectory } from "./git.js";

import { ToolRegistry } from "./registry.js";
import { createReadTool, setReadProjectRoot } from "./read.js";
import { createWriteTool, setWriteProjectRoot } from "./write.js";
import { createEditTool, setEditProjectRoot } from "./edit.js";
import { createGlobTool, setGlobProjectRoot } from "./glob.js";
import { createGrepTool, setGrepProjectRoot } from "./grep.js";
import {
  createBashTool,
  setBashWorkingDirectory,
  setBashBlockedCommands,
} from "./bash.js";
import { createWebSearchTool } from "./web-search.js";
import { createWebFetchTool } from "./web-fetch.js";
import { createGitTool, setGitWorkingDirectory } from "./git.js";
import type { IToolExecutionContext } from "../types/tool.js";

export function createDefaultRegistry(context: IToolExecutionContext): ToolRegistry {
  // Configure module-level settings from context
  setReadProjectRoot(context.projectRoot);
  setWriteProjectRoot(context.projectRoot);
  setEditProjectRoot(context.projectRoot);
  setGlobProjectRoot(context.projectRoot);
  setGrepProjectRoot(context.projectRoot);
  setBashWorkingDirectory(context.workingDirectory);
  setBashBlockedCommands(context.blockedCommands);
  setGitWorkingDirectory(context.workingDirectory);

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
