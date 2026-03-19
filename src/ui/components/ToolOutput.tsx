/**
 * Tool execution output display — delegates to ToolCallDisplay
 * for rich status visualization.
 */

import React from "react";
import { Box } from "ink";
import { ToolCallDisplay } from "./ToolCallDisplay.js";

interface IToolOutputProps {
  readonly toolName: string;
  readonly content: string;
  readonly isError: boolean;
}

export function ToolOutput({
  toolName,
  content,
  isError,
}: IToolOutputProps): React.ReactElement {
  return (
    <Box marginY={0}>
      <ToolCallDisplay
        toolName={toolName}
        status={isError ? "error" : "success"}
        output={content}
        isError={isError}
        isCollapsed={false}
      />
    </Box>
  );
}
