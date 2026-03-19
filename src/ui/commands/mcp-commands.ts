/**
 * /mcp slash command handler.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { ICommandContext } from "./types.js";
import { addSystemMessage } from "./types.js";

export async function handleMcpCommand(args: readonly string[], ctx: ICommandContext): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "list") {
    try {
      const { MCPServerManager } = await import("../../mcp/server-manager.js");
      const manager = new MCPServerManager();
      const connected = manager.getConnectedServers();
      if (connected.length === 0) {
        addSystemMessage(ctx, "No MCP servers connected.\nConfigure servers in ~/.aemeathcli/mcp.json");
      } else {
        const lines = connected.map((name) => {
          const status = manager.getServerStatus(name) ?? "unknown";
          return `  ${name} — ${status}`;
        });
        addSystemMessage(ctx, `MCP Servers:\n${lines.join("\n")}`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addSystemMessage(ctx, `Failed to list MCP servers: ${msg}`);
    }
    return;
  }

  if (subcommand === "add") {
    const name = args[1];
    if (!name) {
      addSystemMessage(ctx, "Usage: /mcp add <server-name>\n\nExample:\n  /mcp add my-server");
      return;
    }
    addSystemMessage(
      ctx,
      `To add MCP server "${name}", add this to ~/.aemeathcli/mcp.json:\n\n` +
      `{\n  "mcpServers": {\n    "${name}": {\n      "command": "npx",\n` +
      `      "args": ["-y", "@your-org/${name}-server"],\n` +
      `      "env": {}\n    }\n  }\n}\n\n` +
      `Then restart AemeathCLI. Use /mcp list to verify the connection.`,
    );
    return;
  }

  addSystemMessage(ctx, "Usage: /mcp list | /mcp add <name>");
}
