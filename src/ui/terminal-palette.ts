/**
 * Terminal color detection and adaptive palette system.
 *
 * Detects color depth (TrueColor / 256 / 16 / none), light-vs-dark background,
 * and resolves hex colors to the best representation the terminal supports.
 * Respects the NO_COLOR standard and the --no-color CLI flag.
 *
 * Pure TypeScript, zero external dependencies.
 */

/** Terminal color-depth tiers, from richest to plainest. */
export type ColorDepth = "truecolor" | "256" | "16" | "none";

/** RGB triple, each channel 0-255. */
interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

/** Standard 16 ANSI colors (indices 0-15). */
const ANSI_16: readonly Rgb[] = [
  rgb(0, 0, 0), rgb(128, 0, 0), rgb(0, 128, 0), rgb(128, 128, 0),
  rgb(0, 0, 128), rgb(128, 0, 128), rgb(0, 128, 128), rgb(192, 192, 192),
  rgb(128, 128, 128), rgb(255, 0, 0), rgb(0, 255, 0), rgb(255, 255, 0),
  rgb(0, 0, 255), rgb(255, 0, 255), rgb(0, 255, 255), rgb(255, 255, 255),
];

/** Build ANSI 256-color table: 0-15 standard, 16-231 cube, 232-255 grayscale. */
function build256Table(): readonly Rgb[] {
  const t: Rgb[] = [...ANSI_16];
  const cube = [0, 95, 135, 175, 215, 255] as const;
  for (let ri = 0; ri < 6; ri++)
    for (let gi = 0; gi < 6; gi++)
      for (let bi = 0; bi < 6; bi++)
        t.push(rgb(cube[ri] ?? 0, cube[gi] ?? 0, cube[bi] ?? 0));
  for (let i = 0; i < 24; i++) { const v = 8 + i * 10; t.push(rgb(v, v, v)); }
  return t;
}

const ANSI_256: readonly Rgb[] = build256Table();

/** Parse a "#RRGGBB" or "#RGB" hex string to an Rgb triple. */
function hexToRgb(hex: string): Rgb {
  const h = hex.replace(/^#/, "");
  if (h.length === 3) {
    const c0 = h[0] ?? "0";
    const c1 = h[1] ?? "0";
    const c2 = h[2] ?? "0";
    return rgb(
      parseInt(c0 + c0, 16),
      parseInt(c1 + c1, 16),
      parseInt(c2 + c2, 16),
    );
  }
  return rgb(
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  );
}

/** Convert an Rgb triple to a "#rrggbb" hex string. */
function rgbToHex(c: Rgb): string {
  const r = c.r.toString(16).padStart(2, "0");
  const g = c.g.toString(16).padStart(2, "0");
  const b = c.b.toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

/**
 * Perceptual color distance (weighted Euclidean, redmean approximation).
 * Low-cost formula from CompuPhase that accounts for human color perception.
 */
function colorDistance(a: Rgb, b: Rgb): number {
  const rMean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db,
  );
}

/** Perceived luminance (ITU-R BT.601). Values > 128 indicate a light color. */
function luminance(c: Rgb): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

/** Clamp a number to the 0-255 byte range. */
function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Find the index into `table` whose entry is closest to `target`. */
function nearestIndex(target: Rgb, table: readonly Rgb[]): number {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < table.length; i++) {
    const entry = table[i];
    if (entry === undefined) continue;
    const d = colorDistance(target, entry);
    if (d < bestDist) { bestDist = d; bestIndex = i; }
  }
  return bestIndex;
}

/** Read an env var, returning undefined for empty/missing values. */
function env(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === "" ? undefined : v;
}

/** Detect the terminal's color depth from environment variables. */
function detectColorDepth(): ColorDepth {
  if (env("NO_COLOR") !== undefined) return "none";

  const force = env("FORCE_COLOR");
  if (force !== undefined) {
    if (force === "0") return "none";
    if (force === "1") return "16";
    if (force === "2") return "256";
    if (force === "3") return "truecolor";
  }

  const colorterm = env("COLORTERM");
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";

  const term = env("TERM") ?? "";
  if (term === "dumb") return "none";

  const termProgram = env("TERM_PROGRAM");
  const trueColorPrograms = ["iTerm.app", "WezTerm", "Hyper", "ghostty", "vscode"];
  if (termProgram !== undefined && trueColorPrograms.includes(termProgram)) return "truecolor";

  if (term.includes("256color") || term.includes("256colours")) return "256";

  const basic16Prefixes = ["xterm", "vt100", "screen", "linux", "ansi"];
  if (basic16Prefixes.some((p) => term.startsWith(p))) return "16";

  if (env("CI") !== undefined && env("GITHUB_ACTIONS") !== undefined) return "truecolor";

  return process.stdout.isTTY ? "16" : "none";
}

/**
 * Detect whether the terminal background is dark.
 * Uses COLORFGBG when available, otherwise defaults to dark (the common case).
 */
function detectDarkBackground(): boolean {
  const fgBg = env("COLORFGBG");
  if (fgBg !== undefined) {
    const parts = fgBg.split(";");
    const bgStr = parts[parts.length - 1];
    if (bgStr !== undefined) {
      const bgIndex = parseInt(bgStr, 10);
      if (!Number.isNaN(bgIndex) && bgIndex >= 0 && bgIndex < ANSI_16.length) {
        const bgColor = ANSI_16[bgIndex];
        if (bgColor !== undefined) return luminance(bgColor) <= 128;
      }
    }
  }
  return true;
}

/**
 * Terminal palette singleton.
 *
 * Exposes detected terminal capabilities and resolves hex colors to the
 * best representation the current terminal supports. Import the pre-built
 * {@link palette} instance rather than constructing your own.
 */
export class TerminalPalette {
  /** Detected color depth of the current terminal. */
  readonly colorDepth: ColorDepth;
  /** `true` when the terminal background is dark. */
  readonly isDarkBackground: boolean;
  /** `true` when the terminal background is light. */
  readonly isLightBackground: boolean;
  /** `true` when any colors can be emitted (depth is not "none"). */
  readonly supportsColor: boolean;

  constructor() {
    this.colorDepth = detectColorDepth();
    this.isDarkBackground = detectDarkBackground();
    this.isLightBackground = !this.isDarkBackground;
    this.supportsColor = this.colorDepth !== "none";
  }

  /**
   * Resolve a hex color to the best representation the terminal supports.
   *
   * - TrueColor: returns the hex unchanged.
   * - 256-color: returns the nearest xterm-256 color index as a string.
   * - 16-color: returns the nearest standard ANSI color index as a string.
   * - none: returns the empty string.
   *
   * @param hex - A "#RRGGBB" or "#RGB" color string.
   */
  resolveColor(hex: string): string {
    switch (this.colorDepth) {
      case "truecolor": return hex;
      case "256": return String(nearestIndex(hexToRgb(hex), ANSI_256));
      case "16": return String(nearestIndex(hexToRgb(hex), ANSI_16));
      case "none": return "";
    }
  }

  /**
   * Alpha-blend a foreground color over a background color.
   *
   * @param fg    - Foreground hex color ("#RRGGBB" or "#RGB").
   * @param bg    - Background hex color.
   * @param alpha - Blend factor: 0 = fully bg, 1 = fully fg.
   * @returns The blended color as a "#rrggbb" string.
   */
  blend(fg: string, bg: string, alpha: number): string {
    const f = hexToRgb(fg);
    const b = hexToRgb(bg);
    const a = Math.max(0, Math.min(1, alpha));
    return rgbToHex(rgb(
      clamp(f.r * a + b.r * (1 - a)),
      clamp(f.g * a + b.g * (1 - a)),
      clamp(f.b * a + b.b * (1 - a)),
    ));
  }

  /**
   * Pick the right color variant for the current background, then resolve it.
   *
   * @param lightHex - Color to use on a light background.
   * @param darkHex  - Color to use on a dark background.
   */
  adaptiveColor(lightHex: string, darkHex: string): string {
    return this.resolveColor(this.isDarkBackground ? darkHex : lightHex);
  }
}

/** Pre-built singleton -- import this rather than constructing your own. */
export const palette = new TerminalPalette();
