/**
 * Tool permission management per PRD section 14.4
 * Permission modes: strict, standard, permissive
 */

import type { PermissionMode, ToolCategory } from "../types/index.js";
import { logger } from "../utils/index.js";
import { isCommandBlocked } from "../utils/index.js";

// Commands that ALWAYS require confirmation regardless of mode
const DANGEROUS_COMMANDS = [
  "rm -rf",
  "git push --force",
  "git reset --hard",
  "git checkout .",
  "git clean -f",
  "git branch -D",
  "drop table",
  "drop database",
  "truncate",
  "format c:",
  "del /f /s /q",
] as const;

export interface IPermissionRequest {
  readonly toolName: string;
  readonly category: ToolCategory;
  readonly operation: string;
  readonly resource?: string;
  readonly command?: string;
}

export interface IPermissionResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly requiresUserApproval: boolean;
}

export class PermissionManager {
  private mode: PermissionMode;
  private readonly allowedPaths: readonly string[];
  private readonly blockedCommands: readonly string[];
  private readonly approvedOperations = new Set<string>();

  constructor(
    mode: PermissionMode,
    allowedPaths: readonly string[],
    blockedCommands: readonly string[],
  ) {
    this.mode = mode;
    this.allowedPaths = allowedPaths;
    this.blockedCommands = blockedCommands;
  }

  /**
   * Check if an operation is permitted.
   */
  check(request: IPermissionRequest): IPermissionResult {
    // Always-blocked operations
    if (request.command && this.isDangerousCommand(request.command)) {
      return {
        allowed: false,
        reason: `Dangerous command detected: "${request.command}"`,
        requiresUserApproval: true,
      };
    }

    // Check against blocked commands list
    if (request.command && isCommandBlocked(request.command, this.blockedCommands)) {
      return {
        allowed: false,
        reason: `Command is on the blocked list`,
        requiresUserApproval: true,
      };
    }

    // Previously approved operations
    const opKey = this.getOperationKey(request);
    if (this.approvedOperations.has(opKey)) {
      return { allowed: true, requiresUserApproval: false };
    }

    // Mode-based permissions
    switch (this.mode) {
      case "permissive":
        return { allowed: true, requiresUserApproval: false };

      case "standard":
        return this.checkStandardMode(request);

      case "strict":
        return this.checkStrictMode(request);
    }
  }

  /**
   * Record that the user has approved an operation.
   */
  approve(request: IPermissionRequest): void {
    const opKey = this.getOperationKey(request);
    this.approvedOperations.add(opKey);
    logger.info({ operation: opKey }, "Operation approved by user");
  }

  /**
   * Update permission mode.
   */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
    this.approvedOperations.clear();
    logger.info({ mode }, "Permission mode changed");
  }

  /**
   * Get current mode.
   */
  getMode(): PermissionMode {
    return this.mode;
  }

  private checkStandardMode(request: IPermissionRequest): IPermissionResult {
    // Read operations auto-approved in standard mode
    if (this.isReadOperation(request)) {
      return { allowed: true, requiresUserApproval: false };
    }

    // Write and shell operations require approval
    return {
      allowed: false,
      reason: `${request.operation} requires approval in standard mode`,
      requiresUserApproval: true,
    };
  }

  private checkStrictMode(request: IPermissionRequest): IPermissionResult {
    // Everything requires approval in strict mode
    return {
      allowed: false,
      reason: `${request.operation} requires approval in strict mode`,
      requiresUserApproval: true,
    };
  }

  private isReadOperation(request: IPermissionRequest): boolean {
    const readTools = ["read", "glob", "grep", "web-search", "web-fetch"];
    return readTools.includes(request.toolName);
  }

  private isDangerousCommand(command: string): boolean {
    const lower = command.toLowerCase().trim();
    return DANGEROUS_COMMANDS.some((dangerous) => lower.includes(dangerous));
  }

  private getOperationKey(request: IPermissionRequest): string {
    return `${request.toolName}:${request.operation}:${request.resource ?? ""}`;
  }
}
