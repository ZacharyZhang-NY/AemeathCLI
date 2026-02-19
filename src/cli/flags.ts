/**
 * Global CLI flag definitions per PRD section 12.3
 */

import type { PermissionMode } from "../types/index.js";

export interface IGlobalFlags {
  readonly model?: string;
  readonly role?: string;
  readonly verbose: boolean;
  readonly noColor: boolean;
  readonly permissionMode?: PermissionMode;
  readonly configPath?: string;
  readonly projectRoot?: string;
}

export const DEFAULT_FLAGS: IGlobalFlags = {
  verbose: false,
  noColor: false,
};
