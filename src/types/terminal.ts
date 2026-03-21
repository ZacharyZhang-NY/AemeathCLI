/**
 * TypeScript types for the AemeathCLI terminal palette, shimmer,
 * streaming, diff, and approval subsystems.
 */

/** Terminal color depth capabilities. */
export type ColorDepth = "truecolor" | "256" | "16" | "none";

/** Terminal background brightness. */
export type BackgroundMode = "light" | "dark" | "unknown";

/** Detected terminal capabilities. */
export interface ITerminalCapabilities {
  readonly colorDepth: ColorDepth;
  readonly backgroundMode: BackgroundMode;
  readonly supportsColor: boolean;
  readonly supportsBracketedPaste: boolean;
  readonly supportsHyperlinks: boolean;
  readonly supportsKeyboardEnhancement: boolean;
  readonly columns: number;
  readonly rows: number;
}

/** Shimmer effect configuration. */
export interface IShimmerConfig {
  readonly periodMs: number;
  readonly bandWidth: number;
  readonly maxIntensity: number;
  readonly enabled: boolean;
}

/** Streaming controller state snapshot. */
export interface IStreamingLineState {
  readonly committedLines: readonly string[];
  readonly pendingLine: string;
  readonly hasEmittedHeader: boolean;
  readonly totalLineCount: number;
}

/** A group of contiguous diff lines sharing the same hunk origin. */
export interface IDiffHunk {
  readonly startLineOld: number;
  readonly startLineNew: number;
  readonly lines: readonly IDiffLine[];
}

/** A single line within a diff hunk. */
export interface IDiffLine {
  readonly type: "addition" | "deletion" | "context" | "hunk-header";
  readonly content: string;
  readonly oldLineNumber?: number | undefined;
  readonly newLineNumber?: number | undefined;
}

/** Categories of operations that require user approval. */
export type ApprovalType = "exec" | "write" | "edit" | "delete" | "network";

/** Possible outcomes of an approval prompt. */
export type ApprovalDecision =
  | "allow"
  | "deny"
  | "allow-session"
  | "allow-always";

/** Data describing a pending approval request. */
export interface IApprovalRequest {
  readonly id: string;
  readonly type: ApprovalType;
  readonly title: string;
  readonly description: string;
  readonly diff?: string | undefined;
  readonly command?: string | undefined;
  readonly url?: string | undefined;
  readonly filePath?: string | undefined;
}

/** A color pair that adapts to the terminal background mode. */
export interface IAdaptiveColor {
  readonly light: string;
  readonly dark: string;
}

/** Full adaptive color theme covering all UI subsystems. */
export interface IAdaptiveTheme {
  readonly text: {
    readonly primary: IAdaptiveColor;
    readonly secondary: IAdaptiveColor;
    readonly muted: IAdaptiveColor;
    readonly accent: IAdaptiveColor;
    readonly response: IAdaptiveColor;
  };
  readonly border: {
    readonly dim: IAdaptiveColor;
    readonly active: IAdaptiveColor;
    readonly focus: IAdaptiveColor;
  };
  readonly diff: {
    readonly addedBg: IAdaptiveColor;
    readonly addedFg: IAdaptiveColor;
    readonly removedBg: IAdaptiveColor;
    readonly removedFg: IAdaptiveColor;
    readonly contextFg: IAdaptiveColor;
    readonly hunkHeaderFg: IAdaptiveColor;
  };
  readonly status: {
    readonly success: IAdaptiveColor;
    readonly error: IAdaptiveColor;
    readonly warning: IAdaptiveColor;
    readonly info: IAdaptiveColor;
    readonly pending: IAdaptiveColor;
    readonly active: IAdaptiveColor;
  };
}
