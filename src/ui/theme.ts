/**
 * Semantic color token system for AemeathCLI terminal UI.
 * Brand palette: pink / rose / off-white / mauve / brown.
 *
 * Exports both the original dark-background tokens (backward-compatible)
 * and a light-background counterpart.  Use {@link resolveColors} or
 * {@link userMessageStyle} to pick the right set at runtime.
 */
import type { IAdaptiveColor, IAdaptiveTheme } from "../types/terminal.js";

/** Primary brand color — unchanged across light and dark modes. */
export const BRAND_COLOR = "#F0C5DA";

// ── Dark-background tokens (original, backward-compatible) ──────────────

/** Semantic color tokens — dark terminal background. */
export const colors = {
  text: { primary: "#F9F5F5", secondary: "#d3acb3", muted: "#9e8085", accent: "#F0C5DA", response: "#F9F5F5" },
  border: { dim: "#6b5459", active: "#d3acb3", focus: "#F0C5DA" },
  syntax: { keyword: "#F0C5DA", string: "#EDD6DC", function: "#F9F5F5", comment: "#9e8085", number: "#EDD6DC", type: "#F0C5DA" },
  status: { success: "#F0C5DA", error: "#f87171", warning: "#EDD6DC", info: "#F0C5DA", pending: "#d3acb3", active: "#F0C5DA" },
  role: { user: "#F0C5DA", assistant: "#F9F5F5", system: "#EDD6DC", tool: "#d3acb3" },
} as const;

// ── Light-background tokens ─────────────────────────────────────────────

/** Semantic color tokens — light terminal background. */
export const lightColors = {
  text: { primary: "#1a0e11", secondary: "#6b3a45", muted: "#9e7a82", accent: "#a83860", response: "#1a0e11" },
  border: { dim: "#d3acb3", active: "#a83860", focus: "#a83860" },
  syntax: { keyword: "#a83860", string: "#8a4058", function: "#1a0e11", comment: "#9e7a82", number: "#8a4058", type: "#a83860" },
  status: { success: "#16a34a", error: "#dc2626", warning: "#ca8a04", info: "#a83860", pending: "#6b3a45", active: "#a83860" },
  role: { user: "#a83860", assistant: "#1a0e11", system: "#8a4058", tool: "#6b3a45" },
} as const;

// ── Diff colors ─────────────────────────────────────────────────────────

/** Diff rendering colors for dark terminal backgrounds. */
export const diffColorsDark = {
  addedBg: "#0d2818", addedFg: "#4ade80",
  removedBg: "#2d0f0f", removedFg: "#f87171",
  contextFg: "#d3acb3", hunkHeaderFg: "#9e8085",
} as const;

/** Diff rendering colors for light terminal backgrounds. */
export const diffColorsLight = {
  addedBg: "#dcfce7", addedFg: "#15803d",
  removedBg: "#fee2e2", removedFg: "#dc2626",
  contextFg: "#6b3a45", hunkHeaderFg: "#9e7a82",
} as const;

// ── Resolved color set ──────────────────────────────────────────────────

/** Shape returned by {@link resolveColors}. */
export interface IResolvedColors {
  readonly text: { readonly primary: string; readonly secondary: string; readonly muted: string; readonly accent: string; readonly response: string };
  readonly border: { readonly dim: string; readonly active: string; readonly focus: string };
  readonly syntax: { readonly keyword: string; readonly string: string; readonly function: string; readonly comment: string; readonly number: string; readonly type: string };
  readonly status: { readonly success: string; readonly error: string; readonly warning: string; readonly info: string; readonly pending: string; readonly active: string };
  readonly role: { readonly user: string; readonly assistant: string; readonly system: string; readonly tool: string };
  readonly diff: { readonly addedBg: string; readonly addedFg: string; readonly removedBg: string; readonly removedFg: string; readonly contextFg: string; readonly hunkHeaderFg: string };
}

// ── Runtime helpers ─────────────────────────────────────────────────────

/**
 * Return the complete color set matching the terminal background.
 * @param isDark - `true` for dark backgrounds, `false` for light.
 */
export function resolveColors(isDark: boolean): IResolvedColors {
  if (isDark) {
    return { text: colors.text, border: colors.border, syntax: colors.syntax, status: colors.status, role: colors.role, diff: diffColorsDark };
  }
  return { text: lightColors.text, border: lightColors.border, syntax: lightColors.syntax, status: lightColors.status, role: lightColors.role, diff: diffColorsLight };
}

/**
 * Background overlay color for the user-message input area.
 * Dark terminals get a subtle 12% white overlay; light terminals
 * get a subtle 4% black overlay.
 * @param isDark - `true` for dark backgrounds, `false` for light.
 */
export function userMessageStyle(isDark: boolean): string {
  return isDark ? "#1f1a1b" : "#f5f0f1";
}

/**
 * Resolve a single {@link IAdaptiveColor} pair to a concrete hex value.
 * @param pair   - An adaptive color with `light` and `dark` variants.
 * @param isDark - `true` to select the dark variant.
 */
export function getAdaptiveColor(pair: IAdaptiveColor, isDark: boolean): string {
  return isDark ? pair.dark : pair.light;
}

// ── Pre-built adaptive theme ────────────────────────────────────────────

/** Adaptive theme conforming to {@link IAdaptiveTheme}. */
export const adaptiveTheme: IAdaptiveTheme = {
  text: {
    primary: { light: lightColors.text.primary, dark: colors.text.primary },
    secondary: { light: lightColors.text.secondary, dark: colors.text.secondary },
    muted: { light: lightColors.text.muted, dark: colors.text.muted },
    accent: { light: lightColors.text.accent, dark: colors.text.accent },
    response: { light: lightColors.text.response, dark: colors.text.response },
  },
  border: {
    dim: { light: lightColors.border.dim, dark: colors.border.dim },
    active: { light: lightColors.border.active, dark: colors.border.active },
    focus: { light: lightColors.border.focus, dark: colors.border.focus },
  },
  diff: {
    addedBg: { light: diffColorsLight.addedBg, dark: diffColorsDark.addedBg },
    addedFg: { light: diffColorsLight.addedFg, dark: diffColorsDark.addedFg },
    removedBg: { light: diffColorsLight.removedBg, dark: diffColorsDark.removedBg },
    removedFg: { light: diffColorsLight.removedFg, dark: diffColorsDark.removedFg },
    contextFg: { light: diffColorsLight.contextFg, dark: diffColorsDark.contextFg },
    hunkHeaderFg: { light: diffColorsLight.hunkHeaderFg, dark: diffColorsDark.hunkHeaderFg },
  },
  status: {
    success: { light: lightColors.status.success, dark: colors.status.success },
    error: { light: lightColors.status.error, dark: colors.status.error },
    warning: { light: lightColors.status.warning, dark: colors.status.warning },
    info: { light: lightColors.status.info, dark: colors.status.info },
    pending: { light: lightColors.status.pending, dark: colors.status.pending },
    active: { light: lightColors.status.active, dark: colors.status.active },
  },
} as const;
