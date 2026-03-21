/**
 * URL-aware text wrapping -- keeps URLs clickable in terminals by refusing
 * to break them mid-token during word-wrap.
 */
const TLD_PATTERN =
  /\.(com|org|net|io|dev|co|edu|gov|mil|app|info|me|us|uk|de|fr|jp|cn|au|ca|ru|br|in|it|nl|se|no|fi|ch|at|be|dk|cz|pl|pt|es|kr|tw|hk|sg|nz|mx|ar|za|il|ie)\b/i;

/** Schemes that unambiguously indicate a URL. */
const SCHEME_RE = /^(?:https?|ftp|file):\/\//i;

/** Bare `www.` prefix followed by at least one domain character. */
const WWW_RE = /^www\.[a-z0-9]/i;

/**
 * Calculate the display width of a string, treating CJK ideographs and
 * fullwidth forms as 2 columns and everything else as 1.
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

/**
 * Return `true` when a code point occupies two terminal columns.
 * Covers CJK Unified Ideographs, Hangul, fullwidth ASCII/punctuation,
 * and a handful of other East Asian wide ranges.
 */
function isFullwidth(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals / symbols
    (cp >= 0x3040 && cp <= 0x33bf) || // Hiragana, Katakana, CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ext A
    (cp >= 0x4e00 && cp <= 0xa4cf) || // CJK Unified + Yi
    (cp >= 0xa960 && cp <= 0xa97c) || // Hangul Jamo Extended-A
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compat Ideographs
    (cp >= 0xfe30 && cp <= 0xfe6b) || // CJK Compat Forms
    (cp >= 0xff01 && cp <= 0xff60) || // Fullwidth ASCII
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1f9ff) || // Misc symbols & emoji
    (cp >= 0x20000 && cp <= 0x2fa1f) // CJK Unified Ext B-F, Compat Supp
  );
}

/**
 * Check whether a whitespace-delimited token looks like a URL.
 * Matches scheme prefixes, `://`, bare `www.`, or common TLD patterns.
 */
export function isUrlLike(token: string): boolean {
  return (
    SCHEME_RE.test(token) ||
    (token.includes("://") && /\S/.test(token.split("://")[1] ?? "")) ||
    WWW_RE.test(token) ||
    TLD_PATTERN.test(token)
  );
}

/**
 * Wrap text to fit within `maxWidth` display columns while preserving URLs
 * on single lines.  Returns an array of wrapped output lines.
 *
 * Rules:
 * - Normal words break at whitespace boundaries.
 * - A URL token is never split. If it exceeds `maxWidth`, it is placed on
 *   its own line (possibly overflowing) so the terminal can still detect it.
 * - Existing hard line-breaks (`\n`) are preserved.
 * - CJK characters are counted as 2 display columns.
 */
export function urlAwareWrap(text: string, maxWidth: number): string[] {
  if (maxWidth < 1) {
    return [text];
  }
  const paragraphs = text.split("\n");
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      result.push("");
      continue;
    }
    const tokens = paragraph.split(/( +)/);
    let currentLine = "";
    let currentWidth = 0;

    for (const token of tokens) {
      if (token === "") {
        continue;
      }
      const tokenWidth = displayWidth(token);

      // Pure whitespace token -- only append if it fits.
      if (/^ +$/.test(token)) {
        if (currentWidth + tokenWidth <= maxWidth) {
          currentLine += token;
          currentWidth += tokenWidth;
        }
        continue;
      }

      // Token fits on the current line.
      if (currentWidth + tokenWidth <= maxWidth) {
        currentLine += token;
        currentWidth += tokenWidth;
        continue;
      }

      // Token does NOT fit. Flush current line if non-empty.
      if (currentLine.trimEnd() !== "") {
        result.push(currentLine.trimEnd());
      }

      // If it is a URL, give it its own line even if it overflows.
      if (isUrlLike(token)) {
        currentLine = token;
        currentWidth = tokenWidth;
        continue;
      }

      // Normal word that is itself wider than maxWidth -- place on new line.
      currentLine = token;
      currentWidth = tokenWidth;
    }

    if (currentLine.trimEnd() !== "") {
      result.push(currentLine.trimEnd());
    } else if (currentLine === "" && paragraph !== "") {
      // Edge case: paragraph was purely whitespace.
      result.push("");
    }
  }

  return result;
}

/**
 * Wrap text with distinct first-line and continuation prefixes.
 *
 * Useful for tree-branch UIs where the first line carries a connector
 * glyph (e.g. `"|- "`) and subsequent lines are indented with spaces.
 *
 * The effective wrapping width is `maxWidth - displayWidth(prefix)`.
 */
export function urlAwareWrapWithPrefix(
  text: string,
  maxWidth: number,
  firstLinePrefix: string,
  subsequentPrefix: string,
): string[] {
  const firstWidth = maxWidth - displayWidth(firstLinePrefix);
  const restWidth = maxWidth - displayWidth(subsequentPrefix);

  if (firstWidth < 1 || restWidth < 1) {
    return [firstLinePrefix + text];
  }

  const rawLines = urlAwareWrap(text, firstWidth);

  if (rawLines.length === 0) {
    return [firstLinePrefix];
  }

  const firstRaw = rawLines[0] ?? "";
  const result = [firstLinePrefix + firstRaw];

  // Re-wrap everything beyond the first line at the subsequent width.
  const remaining = rawLines.slice(1).join("\n");
  if (remaining === "") {
    return result;
  }

  const rewrapped = urlAwareWrap(remaining, restWidth);
  for (const line of rewrapped) {
    result.push(subsequentPrefix + line);
  }

  return result;
}
