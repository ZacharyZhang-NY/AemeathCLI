/**
 * Default single-pane layout per PRD section 6.2
 */

import React from "react";
import { Box, Text } from "ink";
import { MessageView } from "../components/MessageView.js";
import { InputBar } from "../components/InputBar.js";
import { StatusBar } from "../components/StatusBar.js";
import { Spinner } from "../components/Spinner.js";
import type { IChatMessage } from "../../types/index.js";

interface ISinglePaneProps {
  readonly messages: readonly IChatMessage[];
  readonly isProcessing: boolean;
  readonly onSubmit: (input: string) => void;
  readonly model: string;
  readonly role?: string | undefined;
  readonly tokenCount: string;
  readonly cost: string;
  readonly gitBranch?: string | undefined;
  readonly gitChanges?: number | undefined;
  readonly streamingContent?: string | undefined;
}

export function SinglePane({
  messages,
  isProcessing,
  onSubmit,
  model,
  role,
  tokenCount,
  cost,
  gitBranch,
  gitChanges,
  streamingContent,
}: ISinglePaneProps): React.ReactElement {
  return (
    <Box flexDirection="column" height="100%">
      <StatusBar
        model={model}
        role={role}
        tokenCount={tokenCount}
        cost={cost}
        gitBranch={gitBranch}
        gitChanges={gitChanges}
      />
      <MessageView messages={messages} />
      {isProcessing ? (
        <Box flexDirection="column" marginLeft={1} marginBottom={1}>
          <Text color="cyan" bold>
            [{model}]
          </Text>
          <Box marginLeft={2} marginBottom={1}>
            <Text wrap="wrap">{streamingContent && streamingContent.length > 0 ? streamingContent : "..."}</Text>
          </Box>
          <Box marginLeft={1}>
            <Spinner
              label={
                streamingContent && streamingContent.length > 0
                  ? "Streaming response..."
                  : "Thinking..."
              }
            />
          </Box>
        </Box>
      ) : null}
      <InputBar onSubmit={onSubmit} isProcessing={isProcessing} />
    </Box>
  );
}
