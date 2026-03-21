/**
 * Terminal diff renderer with syntax-highlighted line-by-line display.
 *
 * Parses unified diff format (git diff output) and renders additions,
 * deletions, context lines, and hunk headers with theme-aware coloring,
 * gutter signs, and optional line numbers.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

// ── Constants ────────────────────────────────────────────────────────────

const COLOR_ADDED = "#4ade80";
const COLOR_DELETED = "#f87171";
const HUNK_RE = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

// ── Types ────────────────────────────────────────────────────────────────

/** Classification of a single parsed diff line. */
type DiffLineKind = "addition" | "deletion" | "context" | "hunk-header";

/** A parsed line from a unified diff. */
interface IParsedDiffLine {
  readonly kind: DiffLineKind;
  readonly content: string;
  readonly oldLineNo: number | null;
  readonly newLineNo: number | null;
}

/** Props for the DiffRenderer component. */
interface IDiffRendererProps {
  /** File path displayed in the header. */
  readonly filePath: string;
  /** Unified diff string (like git diff output). */
  readonly diff: string;
  /** Max lines to show before truncating (default: 50). */
  readonly maxLines?: number;
  /** Whether to show line numbers (default: true). */
  readonly showLineNumbers?: boolean;
}

// ── Parser ───────────────────────────────────────────────────────────────

/**
 * Parse a unified diff string into classified lines with computed
 * old/new line numbers.
 */
function parseDiff(diff: string): readonly IParsedDiffLine[] {
  const result: IParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diff.split("\n")) {
    // Skip file-level and preamble headers
    if (raw.startsWith("---") || raw.startsWith("+++") ||
        raw.startsWith("diff ") || raw.startsWith("index ")) continue;

    // Hunk header -- reset line counters
    const hm = HUNK_RE.exec(raw);
    if (hm) {
      oldLine = parseInt(hm[1] ?? "0", 10);
      newLine = parseInt(hm[2] ?? "0", 10);
      result.push({ kind: "hunk-header", content: raw, oldLineNo: null, newLineNo: null });
      continue;
    }

    if (raw.startsWith("+")) {
      result.push({ kind: "addition", content: raw.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (raw.startsWith("-")) {
      result.push({ kind: "deletion", content: raw.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else if (raw.startsWith(" ")) {
      result.push({ kind: "context", content: raw.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    } else if (raw.length > 0) {
      result.push({ kind: "context", content: raw, oldLineNo: null, newLineNo: null });
    }
  }
  return result;
}

// ── Sub-components ───────────────────────────────────────────────────────

/** Gutter sign (+, -, or blank) with colored styling. */
function GutterSign({ kind }: { readonly kind: DiffLineKind }): React.ReactElement {
  if (kind === "addition") return <Text color={COLOR_ADDED} bold>{"+ "}</Text>;
  if (kind === "deletion") return <Text color={COLOR_DELETED} bold>{"- "}</Text>;
  return <Text color={colors.text.muted}>{"  "}</Text>;
}

/** Format a line number as a right-aligned 4-char string, or blanks. */
function fmtNo(n: number | null): string {
  return n === null ? "    " : String(n).padStart(4, " ");
}

/** Two-column line number display (old | new). */
function LineNos({ line }: { readonly line: IParsedDiffLine }): React.ReactElement {
  return (
    <Text color={colors.text.muted} dimColor>
      {fmtNo(line.oldLineNo)} {fmtNo(line.newLineNo)}{" \u2502 "}
    </Text>
  );
}

/** A single row of the diff output. */
function DiffLine({ line, nums }: {
  readonly line: IParsedDiffLine;
  readonly nums: boolean;
}): React.ReactElement {
  if (line.kind === "hunk-header") {
    return (
      <Box>
        {nums ? <LineNos line={line} /> : null}
        <GutterSign kind={line.kind} />
        <Text color={colors.text.muted} dimColor italic>{line.content}</Text>
      </Box>
    );
  }
  const textColor = line.kind === "addition" ? COLOR_ADDED
    : line.kind === "deletion" ? COLOR_DELETED
    : colors.text.secondary;

  return (
    <Box>
      {nums ? <LineNos line={line} /> : null}
      <GutterSign kind={line.kind} />
      <Text color={textColor} strikethrough={line.kind === "deletion"}>
        {line.content}
      </Text>
    </Box>
  );
}

// ── Main component ───────────────────────────────────────────────────────

/**
 * Render a unified diff with syntax-highlighted additions/deletions,
 * gutter signs, and optional line numbers inside a bordered box.
 *
 * @example
 * ```tsx
 * <DiffRenderer filePath="src/index.ts" diff={unifiedDiffString} />
 * ```
 */
export function DiffRenderer({
  filePath,
  diff,
  maxLines = 50,
  showLineNumbers = true,
}: IDiffRendererProps): React.ReactElement {
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  const isTruncated = parsed.length > maxLines;
  const visible = isTruncated ? parsed.slice(0, maxLines) : parsed;
  const hiddenCount = parsed.length - visible.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.border.dim} marginY={1}>
      {/* File header */}
      <Box paddingX={1}>
        <Text color={colors.text.accent} bold>{"\u2502 "}</Text>
        <Text color={colors.text.secondary}>{filePath}</Text>
      </Box>

      {/* Diff content */}
      <Box flexDirection="column" paddingX={1}>
        {visible.map((line, i) => (
          <DiffLine key={i} line={line} nums={showLineNumbers} />
        ))}
      </Box>

      {/* Truncation notice */}
      {isTruncated ? (
        <Box paddingX={1}>
          <Text color={colors.text.muted} dimColor italic>
            {"\u2026 "}{hiddenCount} more line{hiddenCount === 1 ? "" : "s"} hidden
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export type { IDiffRendererProps, IParsedDiffLine, DiffLineKind };
