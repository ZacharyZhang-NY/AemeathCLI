/**
 * Smart line and text truncation utilities.
 *
 * Provides Unicode-aware single-line truncation, head/tail truncation for
 * multi-line tool output, and compact formatting helpers for numbers and
 * durations.
 */

/**
 * Calculate the display width of a string. CJK ideographs and fullwidth
 * forms count as 2 terminal columns; all other characters count as 1.
 */
export function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      continue;
    }
    if (isFullwidth(cp)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/** Return `true` when a code point occupies two terminal columns. */
function isFullwidth(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3040 && cp <= 0x33bf) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97c) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6b) ||
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x2fa1f)
  );
}

/** The ellipsis character used when truncating. */
const ELLIPSIS = "\u2026";

/** Display width of the ellipsis (always 1 column). */
const ELLIPSIS_WIDTH = 1;

/**
 * Truncate a single line to `maxWidth` display columns. If the line exceeds
 * the limit, characters are removed from the end and replaced with an
 * ellipsis (`\u2026`).
 *
 * The function iterates by Unicode code-point (via `for...of`) so it never
 * splits a surrogate pair or a multi-byte character.
 *
 * @returns The (possibly truncated) string whose `displayWidth` is at most
 *          `maxWidth`.
 */
export function truncateLine(line: string, maxWidth: number): string {
  if (maxWidth < 1) {
    return "";
  }
  const lineWidth = displayWidth(line);
  if (lineWidth <= maxWidth) {
    return line;
  }

  // We need room for the ellipsis.
  const budget = maxWidth - ELLIPSIS_WIDTH;
  if (budget <= 0) {
    return ELLIPSIS;
  }

  let width = 0;
  let result = "";
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      continue;
    }
    const charWidth = isFullwidth(cp) ? 2 : 1;
    if (width + charWidth > budget) {
      break;
    }
    result += ch;
    width += charWidth;
  }

  return result + ELLIPSIS;
}

/**
 * Result of a head/tail truncation operation.
 */
export interface HeadTailResult {
  /** The output lines (head + separator + tail, or all lines if not truncated). */
  readonly lines: string[];
  /** The number of lines hidden in the middle. */
  readonly truncatedCount: number;
  /** Whether any truncation occurred. */
  readonly wasTruncated: boolean;
}

/**
 * Truncate multi-line text by keeping the first `headLines` and last
 * `tailLines`, replacing everything in between with a compact summary line
 * such as `"\u2026 +42 lines"`.
 *
 * This is the preferred presentation for tool output (e.g. shell command
 * results), replacing the naive `output.slice(0, 2000)` approach.
 *
 * If the total number of lines is small enough that no truncation is needed,
 * all lines are returned verbatim.
 */
export function headTailTruncate(
  text: string,
  headLines: number,
  tailLines: number,
): HeadTailResult {
  if (text === "") {
    return { lines: [], truncatedCount: 0, wasTruncated: false };
  }

  const allLines = text.split("\n");
  const total = allLines.length;

  // Nothing to truncate if everything fits.
  if (total <= headLines + tailLines) {
    return { lines: allLines, truncatedCount: 0, wasTruncated: false };
  }

  const head = allLines.slice(0, headLines);
  const tail = allLines.slice(total - tailLines);
  const truncatedCount = total - headLines - tailLines;

  const separator = `\u2026 +${compactNumber(truncatedCount)} lines`;

  return {
    lines: [...head, separator, ...tail],
    truncatedCount,
    wasTruncated: true,
  };
}

/**
 * Format a number in compact notation.
 *
 * - Values below 1 000 are returned as-is (stringified).
 * - 1 000 -- 999 999 become e.g. `"1.2K"`.
 * - 1 000 000+ become e.g. `"1.2M"`.
 *
 * One decimal place is shown; trailing `.0` is kept for consistency.
 */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs < 1_000) {
    return `${sign}${abs}`;
  }
  if (abs < 1_000_000) {
    return `${sign}${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
}

/**
 * Format a millisecond duration in compact human-readable form.
 *
 * - Under 1 000 ms: `"500ms"`
 * - 1 000 ms -- 59 999 ms: `"1.5s"` (one decimal)
 * - 60 000 ms+: `"1m 30s"` (no decimals)
 */
export function compactDuration(ms: number): string {
  if (ms < 0) {
    return "0ms";
  }
  if (ms < 1_000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}
