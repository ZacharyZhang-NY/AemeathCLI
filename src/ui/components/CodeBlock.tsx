/**
 * Code block display with themed line numbers and language label.
 */

import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

interface ICodeBlockProps {
  readonly code: string;
  readonly language?: string | undefined;
  readonly fileName?: string | undefined;
}

export function CodeBlock({
  code,
  language,
  fileName,
}: ICodeBlockProps): React.ReactElement {
  const lines = code.split("\n");

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.border.dim}
      marginY={1}
    >
      {(fileName ?? language) ? (
        <Box paddingX={1}>
          <Text color={colors.text.muted} dimColor>
            {fileName ?? language}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" paddingX={1}>
        {lines.map((line, index) => (
          <Box key={index}>
            <Text color={colors.text.muted} dimColor>
              {String(index + 1).padStart(3, " ")} {"\u2502"}{" "}
            </Text>
            <Text color={colors.text.response}>{line}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
