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
  readonly onCancel?: (() => void) | undefined;
  readonly model: string;
  readonly role?: string | undefined;
  readonly tokenCount: string;
  readonly cost: string;
  readonly gitBranch?: string | undefined;
  readonly gitChanges?: number | undefined;
  readonly streamingContent?: string | undefined;
  /** Current tool activity label (e.g. "Reading src/foo.ts"). */
  readonly activity?: string | undefined;
}

/** Shorten model ID for display: "claude-sonnet-4-6" → "Sonnet 4.6" */
function shortModelName(model: string): string {
  if (model.includes("opus")) return "Opus 4.6";
  if (model.includes("sonnet")) return "Sonnet 4.6";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model.includes("gpt-5.2-mini")) return "GPT-5.2m";
  if (model.includes("gpt-5.2")) return "GPT-5.2";
  if (model.includes("o3")) return "o3";
  if (model.includes("gemini") && model.includes("pro")) return "Gem Pro";
  if (model.includes("gemini") && model.includes("flash")) return "Gem Flash";
  if (model.includes("kimi") || model.includes("k2")) return "Kimi";
  return model;
}

/** Truncate text to last N lines for bounded display */
function tailLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(-maxLines).join("\n");
}

export function SinglePane({
  messages,
  isProcessing,
  onSubmit,
  onCancel,
  model,
  role,
  tokenCount,
  cost,
  gitBranch,
  gitChanges,
  streamingContent,
  activity,
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
      {messages.length === 0 && !isProcessing ? (
        <Box flexDirection="column" flexGrow={1} paddingX={2} justifyContent="center">
          <Text color="cyan" bold>{"\u2726"} AemeathCLI</Text>
          <Text color="gray">Multi-model AI coding assistant</Text>
          <Text>{" "}</Text>
          <Text color="gray">Type a message to start, or use /help for commands.</Text>
          <Text color="gray">Press Tab for autocomplete on /commands, @context, and $skills.</Text>
        </Box>
      ) : (
        <>
          <MessageView messages={messages} />
          {isProcessing ? (
            <Box flexDirection="column" marginLeft={1} marginBottom={1}>
              <Box>
                <Text color="cyan" bold>
                  {"\u2726"} {shortModelName(model)}
                </Text>
              </Box>
              <Box marginLeft={2} marginBottom={1}>
                <Text wrap="wrap">{streamingContent && streamingContent.length > 0 ? tailLines(streamingContent, 12) : ""}</Text>
              </Box>
              <Box marginLeft={1}>
                <Spinner
                  label={
                    activity
                      ? activity
                      : streamingContent && streamingContent.length > 0
                        ? "Streaming response..."
                        : "Thinking..."
                  }
                />
              </Box>
            </Box>
          ) : null}
        </>
      )}
      <InputBar onSubmit={onSubmit} isProcessing={isProcessing} onCancel={onCancel} />
    </Box>
  );
}
