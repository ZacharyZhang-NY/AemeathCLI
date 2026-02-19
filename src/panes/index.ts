/**
 * Split-panel module — barrel export per PRD section 9.
 */

export { TmuxManager } from "./tmux-manager.js";
export type { ITmuxPaneInfo } from "./tmux-manager.js";

export { ITerm2Manager } from "./iterm2-manager.js";
export type { IITerm2PaneInfo } from "./iterm2-manager.js";

export { IPCHub } from "./ipc-hub.js";

export { PaneProcess } from "./pane-process.js";

export { LayoutEngine } from "./layout-engine.js";
export type { IPaneGeometry, IComputedLayout } from "./layout-engine.js";
