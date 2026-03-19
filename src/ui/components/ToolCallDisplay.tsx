/**
 * Rich tool execution visualization with animated status icons,
 * progress tracking, duration, and expandable output.
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

/** Animated status icon */
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Map tool name to a descriptive icon character */
function getToolIcon(name: string): string {
  switch (name) {
    case "read":
      return "\u{1F4C4}";
    case "write":
      return "\u270F\uFE0F";
    case "edit":
      return "\u{1F4DD}";
    case "glob":
      return "\u{1F50D}";
    case "grep":
      return "\u{1F50E}";
    case "bash":
      return "\u26A1";
    case "web_search":
    case "webSearch":
      return "\u{1F310}";
    case "web_fetch":
    case "webFetch":
      return "\u{1F4E1}";
    default:
      return "\u2699";
  }
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
  const borderColor =
    status === "error"
      ? colors.status.error
      : status === "executing"
        ? colors.status.active
        : colors.border.dim;

  const icon = getToolIcon(toolName);

  return (
    <Box flexDirection="column" marginY={0}>
      {/* Header line: status-icon  tool-icon tool-name  description  (duration) */}
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

      {/* Expandable output section */}
      {!isCollapsed && output ? (
        <Box
          flexDirection="column"
          marginLeft={2}
          borderStyle="single"
          borderLeft
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor={borderColor}
          paddingLeft={1}
        >
          <Text
            wrap="wrap"
            color={isError ? colors.status.error : colors.text.secondary}
          >
            {output.length > 2000
              ? output.slice(0, 2000) + "\n\u2026 (truncated)"
              : output}
          </Text>
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
