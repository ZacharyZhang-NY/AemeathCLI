/**
 * Rich tool output formatter with Codex-style head/tail truncation
 * and tree-branch visual prefixes. Handles ANSI escape sequences
 * in output (preserves colors from stderr).
 */

import React from "react";
import { Box, Text } from "ink";
import { ToolCallDisplay } from "./ToolCallDisplay.js";
import { colors } from "../theme.js";

interface IToolOutputProps {
  readonly toolName: string;
  readonly content: string;
  readonly isError: boolean;
}

const HEAD_LINES = 5;
const TAIL_LINES = 2;

/** Strip ANSI escape codes for line counting (display preserves them) */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Count non-empty visible lines in output */
function countVisibleLines(text: string): number {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return lines.length - 1;
  }
  return lines.length;
}

interface ITruncatedOutput {
  readonly lines: readonly string[];
  readonly totalLines: number;
  readonly omittedLines: number;
}

/** Split output into head/tail with truncation info */
function truncateOutput(raw: string): ITruncatedOutput {
  const allLines = raw.split("\n");
  // Strip trailing empty line from final newline
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }
  const total = allLines.length;

  if (total <= HEAD_LINES + TAIL_LINES) {
    return { lines: allLines, totalLines: total, omittedLines: 0 };
  }

  const head = allLines.slice(0, HEAD_LINES);
  const tail = allLines.slice(total - TAIL_LINES);
  const omitted = total - HEAD_LINES - TAIL_LINES;

  return {
    lines: [...head, `\u2026 +${omitted} lines`, ...tail],
    totalLines: total,
    omittedLines: omitted,
  };
}

/** Render a single output line with tree-branch prefix */
function OutputLine({
  line,
  isFirst,
  isOmitted,
  isError,
}: {
  readonly line: string;
  readonly isFirst: boolean;
  readonly isOmitted: boolean;
  readonly isError: boolean;
}): React.ReactElement {
  const prefix = isFirst ? "  \u2514 " : "    ";
  const textColor = isOmitted
    ? colors.text.muted
    : isError
      ? colors.status.error
      : colors.text.secondary;

  return (
    <Text wrap="truncate" dimColor color={textColor}>
      {prefix}
      {line}
    </Text>
  );
}

export function ToolOutput({
  toolName,
  content,
  isError,
}: IToolOutputProps): React.ReactElement {
  const hasContent = content.length > 0;
  const visibleLineCount = hasContent ? countVisibleLines(content) : 0;
  const strippedLength = hasContent ? stripAnsi(content).length : 0;

  // For very short output (single line, under 120 chars), inline it
  if (hasContent && visibleLineCount <= 1 && strippedLength <= 120) {
    return (
      <Box marginY={0} flexDirection="column">
        <ToolCallDisplay
          toolName={toolName}
          status={isError ? "error" : "success"}
          isCollapsed
        />
        <Text dimColor color={isError ? colors.status.error : colors.text.secondary}>
          {"  \u2514 "}
          {content.trim()}
        </Text>
      </Box>
    );
  }

  // For multi-line output, use head/tail truncation
  if (hasContent) {
    const { lines, totalLines, omittedLines } = truncateOutput(content);
    const omitLineIndex = omittedLines > 0 ? HEAD_LINES : -1;

    return (
      <Box marginY={0} flexDirection="column">
        <ToolCallDisplay
          toolName={toolName}
          status={isError ? "error" : "success"}
          isCollapsed
        />
        {lines.map((line, i) => (
          <OutputLine
            key={i}
            line={line}
            isFirst={i === 0}
            isOmitted={i === omitLineIndex}
            isError={isError}
          />
        ))}
        {totalLines > HEAD_LINES + TAIL_LINES ? (
          <Text dimColor color={colors.text.muted}>
            {"    "}({totalLines} lines total)
          </Text>
        ) : null}
      </Box>
    );
  }

  // No content — just show the tool header
  return (
    <Box marginY={0}>
      <ToolCallDisplay
        toolName={toolName}
        status={isError ? "error" : "success"}
        isCollapsed
      />
    </Box>
  );
}
