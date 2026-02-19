/**
 * Syntax-highlighted code block display per PRD section 6.2
 * Uses basic ANSI colors for code highlighting in terminal
 */

import React from "react";
import { Box, Text } from "ink";

interface ICodeBlockProps {
  readonly code: string;
  readonly language?: string;
  readonly fileName?: string;
}

export function CodeBlock({
  code,
  language,
  fileName,
}: ICodeBlockProps): React.ReactElement {
  const lines = code.split("\n");

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" marginY={1}>
      {(fileName ?? language) ? (
        <Box paddingX={1} borderBottom>
          <Text color="gray" dimColor>
            {fileName ?? language}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" paddingX={1}>
        {lines.map((line, index) => (
          <Box key={index}>
            <Text color="gray" dimColor>
              {String(index + 1).padStart(4, " ")}{" "}
            </Text>
            <Text>{line}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
