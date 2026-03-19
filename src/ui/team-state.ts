/**
 * Module-level active team state shared between team commands and team launcher.
 * Extracted from App.tsx to enforce the 300-line component limit (PRD 6.2).
 */

import type { TeamManager } from "../teams/team-manager.js";

let activeTeamManager: TeamManager | undefined;
let activeTeamName: string | undefined;
let activeTmuxCleanup: (() => Promise<void>) | undefined;

export function getActiveTeamManager(): TeamManager | undefined {
  return activeTeamManager;
}

export function setActiveTeamManager(manager: TeamManager | undefined): void {
  activeTeamManager = manager;
}

export function getActiveTeamName(): string | undefined {
  return activeTeamName;
}

export function setActiveTeamName(name: string | undefined): void {
  activeTeamName = name;
}

export function getActiveTmuxCleanup(): (() => Promise<void>) | undefined {
  return activeTmuxCleanup;
}

export function setActiveTmuxCleanup(cleanup: (() => Promise<void>) | undefined): void {
  activeTmuxCleanup = cleanup;
}
