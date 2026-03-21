/**
 * Tool execution display with Codex-style head/tail output truncation
 * and tree-branch visual prefixes for compact, readable output.
 */

import React from "react";
import { Box, Text } from "ink";
import { GradientSpinner } from "./GradientSpinner.js";
import { colors } from "../theme.js";

export type ToolStatus =
  | "pending"
  | "executing"
  | "success"
  | "error"
  | "cancelled";

interface IToolCallDisplayProps {
  readonly toolName: string;
  readonly status: ToolStatus;
  readonly description?: string | undefined;
  readonly output?: string | undefined;
  readonly isError?: boolean | undefined;
  readonly duration?: number | undefined;
  readonly isCollapsed?: boolean | undefined;
}

/** Status icon per execution state */
function StatusIcon({
  status,
}: {
  readonly status: ToolStatus;
}): React.ReactElement {
  switch (status) {
    case "pending":
      return <Text color={colors.text.muted}>{"\u25CB"}</Text>;
    case "executing":
      return <GradientSpinner variant="dots" />;
    case "success":
      return <Text color={colors.status.success}>{"\u2713"}</Text>;
    case "error":
      return <Text color={colors.status.error}>{"\u2717"}</Text>;
    case "cancelled":
      return <Text color={colors.text.muted}>{"\u2298"}</Text>;
  }
}

/** Compact duration: 500ms, 1.5s, 1m 30s, 1h 23m 45s */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) {
    const frac = ms % 1000;
    return frac >= 100 ? `${(ms / 1000).toFixed(1)}s` : `${totalSec}s`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return seconds > 0
    ? `${hours}h ${remainMin}m ${seconds}s`
    : `${hours}h ${remainMin}m`;
}

const TOOL_ICONS: Readonly<Record<string, string>> = {
  read: "\u{1F4C4}", write: "\u270F\uFE0F", edit: "\u{1F4DD}",
  glob: "\u{1F50D}", grep: "\u{1F50E}", bash: "\u26A1",
  web_search: "\u{1F310}", webSearch: "\u{1F310}",
  web_fetch: "\u{1F4E1}", webFetch: "\u{1F4E1}",
};

function getToolIcon(name: string): string {
  return TOOL_ICONS[name] ?? "\u2699";
}

const HEAD_LINES = 5;
const TAIL_LINES = 2;

/** Build head/tail truncated lines with tree-branch prefixes */
function formatOutputLines(raw: string): readonly string[] {
  const allLines = raw.split("\n");
  // Strip trailing empty line from final newline
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }
  const total = allLines.length;

  if (total <= HEAD_LINES + TAIL_LINES) {
    return allLines.map((line, i) => {
      const prefix = i === 0 ? "  \u2514 " : "    ";
      return `${prefix}${line}`;
    });
  }

  const head = allLines.slice(0, HEAD_LINES);
  const tail = allLines.slice(total - TAIL_LINES);
  const omitted = total - HEAD_LINES - TAIL_LINES;

  const result: string[] = [];
  head.forEach((line, i) => {
    const prefix = i === 0 ? "  \u2514 " : "    ";
    result.push(`${prefix}${line}`);
  });
  result.push(`    \u2026 +${omitted} lines`);
  tail.forEach((line) => {
    result.push(`    ${line}`);
  });

  return result;
}

export function ToolCallDisplay({
  toolName,
  status,
  description,
  output,
  isError,
  duration,
  isCollapsed = true,
}: IToolCallDisplayProps): React.ReactElement {
  const icon = getToolIcon(toolName);

  return (
    <Box flexDirection="column" marginY={0}>
      {/* Header: status-icon  tool-icon tool-name  description  (duration) */}
      <Box>
        <StatusIcon status={status} />
        <Text> </Text>
        <Text color={colors.role.tool} bold>
          {icon} {toolName}
        </Text>
        {description ? (
          <Text color={colors.text.muted}> {description}</Text>
        ) : null}
        {duration !== undefined && status !== "executing" ? (
          <Text color={colors.text.muted} dimColor>
            {" "}
            ({formatDuration(duration)})
          </Text>
        ) : null}
      </Box>

      {/* Tree-branch output with head/tail truncation */}
      {!isCollapsed && output ? (
        <Box flexDirection="column">
          {formatOutputLines(output).map((line, i) => (
            <Text
              key={i}
              wrap="truncate"
              dimColor
              color={isError ? colors.status.error : colors.text.secondary}
            >
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

/** Compact group display for multiple tool calls in a message */
interface IToolCallGroupProps {
  readonly tools: readonly {
    readonly name: string;
    readonly status: ToolStatus;
    readonly description?: string | undefined;
    readonly duration?: number | undefined;
  }[];
}

export function ToolCallGroup({
  tools,
}: IToolCallGroupProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginLeft={2}>
      {tools.map((tool, i) => (
        <ToolCallDisplay
          key={i}
          toolName={tool.name}
          status={tool.status}
          description={tool.description}
          duration={tool.duration}
        />
      ))}
    </Box>
  );
}
