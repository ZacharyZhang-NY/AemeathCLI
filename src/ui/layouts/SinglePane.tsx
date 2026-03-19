/**
 * Default single-pane layout with animated welcome screen,
 * streaming content display, and thinking indicator.
 */

import React, { useRef } from "react";
import { Box, Text } from "ink";
import { MessageView } from "../components/MessageView.js";
import { InputBar } from "../components/InputBar.js";
import { StatusBar } from "../components/StatusBar.js";
import { ThinkingIndicator } from "../components/ThinkingIndicator.js";
import { WelcomeScreen } from "../components/WelcomeScreen.js";
import { MarkdownContent } from "../components/MarkdownContent.js";
import { colors } from "../theme.js";
import type { InputMode } from "../components/InputBar.js";
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
  readonly activity?: string | undefined;
  readonly initialHistory?: readonly string[] | undefined;
  readonly mode?: InputMode | undefined;
  readonly onModeChange?: ((mode: InputMode) => void) | undefined;
}

/** Shorten model ID for display */
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
  initialHistory,
  mode,
  onModeChange,
}: ISinglePaneProps): React.ReactElement {
  // Track when processing started for elapsed time display
  const processingStartRef = useRef<number | undefined>(undefined);
  if (isProcessing && processingStartRef.current === undefined) {
    processingStartRef.current = Date.now();
  } else if (!isProcessing) {
    processingStartRef.current = undefined;
  }

  const hasContent = streamingContent !== undefined && streamingContent.length > 0;

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
        /* ── Welcome screen ────────────────────────────────── */
        <WelcomeScreen version="1.0.10" />
      ) : (
        <>
          <MessageView messages={messages} />

          {isProcessing ? (
            <Box flexDirection="column" marginLeft={1} marginBottom={1}>
              {/* Streaming content preview */}
              {hasContent ? (
                <Box flexDirection="column" marginLeft={2} marginBottom={1}>
                  <Box>
                    <Text color={colors.role.assistant} bold>
                      {"\u2726"} {shortModelName(model)}
                    </Text>
                  </Box>
                  <Box marginLeft={2}>
                    <MarkdownContent content={tailLines(streamingContent, 12)} />
                  </Box>
                </Box>
              ) : null}

              {/* Thinking indicator with elapsed time */}
              <ThinkingIndicator
                activity={activity}
                isStreaming={hasContent}
                modelName={hasContent ? undefined : shortModelName(model)}
                startTime={processingStartRef.current}
              />
            </Box>
          ) : null}
        </>
      )}

      <InputBar
        onSubmit={onSubmit}
        isProcessing={isProcessing}
        onCancel={onCancel}
        initialHistory={initialHistory}
        mode={mode}
        onModeChange={onModeChange}
      />
    </Box>
  );
}
