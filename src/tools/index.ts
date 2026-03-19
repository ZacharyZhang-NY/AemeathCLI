/**
 * Tools barrel export and default registry factory.
 * Per PRD section 5.1
 */

export { ToolRegistry } from "./registry.js";

export { createReadTool, setReadProjectRoot, setReadAllowedPaths } from "./read.js";
export { createWriteTool, setWriteProjectRoot, setWriteAllowedPaths } from "./write.js";
export { createEditTool, setEditProjectRoot, setEditAllowedPaths } from "./edit.js";
export { createGlobTool, setGlobProjectRoot, setGlobAllowedPaths } from "./glob.js";
export { createGrepTool, setGrepProjectRoot, setGrepAllowedPaths } from "./grep.js";
export { createBashTool, setBashWorkingDirectory, setBashBlockedCommands, setBashAllowedPaths } from "./bash.js";
export { createWebSearchTool, setWebSearchProvider } from "./web-search.js";
export { createWebFetchTool } from "./web-fetch.js";
export { createGitTool, setGitWorkingDirectory } from "./git.js";

import { ToolRegistry } from "./registry.js";
import { createReadTool, setReadProjectRoot, setReadAllowedPaths } from "./read.js";
import { createWriteTool, setWriteProjectRoot, setWriteAllowedPaths } from "./write.js";
import { createEditTool, setEditProjectRoot, setEditAllowedPaths } from "./edit.js";
import { createGlobTool, setGlobProjectRoot, setGlobAllowedPaths } from "./glob.js";
import { createGrepTool, setGrepProjectRoot, setGrepAllowedPaths } from "./grep.js";
import {
  createBashTool,
  setBashWorkingDirectory,
  setBashBlockedCommands,
  setBashAllowedPaths,
} from "./bash.js";
import { createWebSearchTool } from "./web-search.js";
import { createWebFetchTool } from "./web-fetch.js";
import { createGitTool, setGitWorkingDirectory } from "./git.js";
import type { IToolExecutionContext } from "../types/tool.js";

export function createDefaultRegistry(context: IToolExecutionContext): ToolRegistry {
  // Configure module-level settings from context
  setReadProjectRoot(context.projectRoot);
  setReadAllowedPaths(context.allowedPaths);
  setWriteProjectRoot(context.projectRoot);
  setWriteAllowedPaths(context.allowedPaths);
  setEditProjectRoot(context.projectRoot);
  setEditAllowedPaths(context.allowedPaths);
  setGlobProjectRoot(context.projectRoot);
  setGlobAllowedPaths(context.allowedPaths);
  setGrepProjectRoot(context.projectRoot);
  setGrepAllowedPaths(context.allowedPaths);
  setBashWorkingDirectory(context.workingDirectory);
  setBashBlockedCommands(context.blockedCommands);
  setBashAllowedPaths(context.allowedPaths);
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
