/**
 * Tool execution output display per PRD section 6.2
 */

import React from "react";
import { Box, Text } from "ink";

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
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isError ? "red" : "gray"}
      paddingX={1}
      marginY={1}
    >
      <Text color={isError ? "red" : "magenta"} bold>
        {isError ? "Error" : "Tool"}: {toolName}
      </Text>
      <Box marginLeft={2}>
        <Text wrap="wrap" {...(isError ? { color: "red" as const } : {})}>
          {content.length > 2000 ? content.slice(0, 2000) + "\n... (truncated)" : content}
        </Text>
      </Box>
    </Box>
  );
}
