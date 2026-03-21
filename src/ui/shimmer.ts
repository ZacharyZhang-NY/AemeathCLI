/**
 * Time-synchronized shimmer sweep effect for terminal text.
 *
 * A Gaussian-like light band sweeps across characters on a configurable
 * period (default 2 s). Position is derived from `Date.now()` so every
 * consumer stays in sync without shared state.
 *
 * - **TrueColor** — blends foreground toward white at calculated intensity.
 * - **Fallback**  — cycles bold / normal / dim modifiers instead.
 */

/** Per-character shimmer metadata. */
export interface ShimmerChar {
  readonly char: string;
  /** Highlight intensity in [0, 0.9]. */
  readonly intensity: number;
  /** Hex color after TrueColor blending (or the original base color). */
  readonly color: string;
  readonly bold: boolean;
  readonly dim: boolean;
}

/** A styled span suitable for Ink `<Text>` elements. */
export interface ShimmerSpan {
  readonly text: string;
  readonly color: string;
  readonly bold: boolean;
  readonly dim: boolean;
}

/* ---- constants --------------------------------------------------- */

const DEFAULT_PERIOD_MS = 2000;
const BAND_WIDTH = 10;
const MAX_INTENSITY = 0.9;

/* ---- internal helpers -------------------------------------------- */

/** Cached TrueColor detection (checked once via `COLORTERM`). */
let trueColorCached: boolean | undefined;
function supportsTrueColor(): boolean {
  if (trueColorCached === undefined) {
    const ct = process.env["COLORTERM"] ?? "";
    trueColorCached = ct === "truecolor" || ct === "24bit";
  }
  return trueColorCached;
}

/**
 * Parse a 3- or 6-digit hex color into [r, g, b].
 * Returns [255, 255, 255] for unparseable input so the effect degrades
 * gracefully rather than crashing.
 */
function parseHex(hex: string): [number, number, number] {
  let raw = hex.startsWith("#") ? hex.slice(1) : hex;
  if (raw.length === 3) {
    const c0 = raw[0] ?? "f";
    const c1 = raw[1] ?? "f";
    const c2 = raw[2] ?? "f";
    raw = c0 + c0 + c1 + c1 + c2 + c2;
  }
  if (raw.length !== 6) return [255, 255, 255];
  const n = parseInt(raw, 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Convert [r, g, b] to a `#rrggbb` hex string. */
function toHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}

/** Blend a single channel toward white: `base + (255 - base) * intensity`. */
function blendChannel(base: number, intensity: number): number {
  return base + (255 - base) * intensity;
}

/* ---- public API -------------------------------------------------- */

/**
 * Calculate shimmer intensity for a single character position.
 *
 * @param charIndex   Zero-based index of the character in the string.
 * @param totalLength Total number of visible characters.
 * @param periodMs    Full sweep period in ms (default 2000).
 * @returns A value in [0, 0.9].
 */
export function shimmerIntensity(
  charIndex: number,
  totalLength: number,
  periodMs: number = DEFAULT_PERIOD_MS,
): number {
  const totalWidth = totalLength + BAND_WIDTH;
  const progress = (Date.now() % periodMs) / periodMs;
  const bandCenter = progress * totalWidth;
  const distance = Math.abs(charIndex - bandCenter) / (totalWidth / 2);
  return Math.max(0, Math.cos(distance * (Math.PI / 2))) * MAX_INTENSITY;
}

/**
 * Apply the shimmer effect to every character in `text`.
 *
 * In TrueColor mode each character's foreground is blended toward white.
 * In fallback mode bold/dim modifiers are set instead.
 *
 * @param text      The plain-text string to shimmer.
 * @param baseColor Hex color of the un-highlighted text (e.g. `"#F0C5DA"`).
 * @returns One {@link ShimmerChar} per character.
 */
export function shimmerText(text: string, baseColor: string): ShimmerChar[] {
  const len = text.length;
  const trueColor = supportsTrueColor();
  const [br, bg, bb] = parseHex(baseColor);
  const result: ShimmerChar[] = [];

  for (let i = 0; i < len; i++) {
    const intensity = shimmerIntensity(i, len);
    if (trueColor) {
      const color = toHex(
        blendChannel(br, intensity),
        blendChannel(bg, intensity),
        blendChannel(bb, intensity),
      );
      const ch = text[i] ?? " ";
      result.push({ char: ch, intensity, color, bold: false, dim: false });
    } else {
      const bold = intensity > 0.6;
      const dim = intensity <= 0.1;
      const ch = text[i] ?? " ";
      result.push({ char: ch, intensity, color: baseColor, bold, dim });
    }
  }

  return result;
}

/**
 * Convert shimmer output into a minimal set of styled spans for Ink.
 *
 * Adjacent characters sharing the same style are coalesced into one span
 * to reduce the number of React elements.
 *
 * @param text      The plain-text string to shimmer.
 * @param baseColor Hex color of the un-highlighted text.
 * @returns An array of {@link ShimmerSpan} objects.
 */
export function shimmerToInkSpans(
  text: string,
  baseColor: string,
): ShimmerSpan[] {
  const chars = shimmerText(text, baseColor);
  if (chars.length === 0) return [];

  const spans: ShimmerSpan[] = [];
  const first = chars[0];
  if (first === undefined) return [];
  let curText = first.char;
  let curColor = first.color;
  let curBold = first.bold;
  let curDim = first.dim;

  for (let i = 1; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === undefined) continue;
    if (ch.color === curColor && ch.bold === curBold && ch.dim === curDim) {
      curText += ch.char;
    } else {
      spans.push({ text: curText, color: curColor, bold: curBold, dim: curDim });
      curText = ch.char;
      curColor = ch.color;
      curBold = ch.bold;
      curDim = ch.dim;
    }
  }

  spans.push({ text: curText, color: curColor, bold: curBold, dim: curDim });
  return spans;
}
