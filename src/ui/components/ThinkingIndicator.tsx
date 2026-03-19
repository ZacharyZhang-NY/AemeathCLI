/**
 * AI thinking / processing state visualization.
 * Shows animated spinner with cycling status phrases, elapsed time,
 * and optional tool-activity description.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { GradientSpinner } from "./GradientSpinner.js";
import { colors } from "../theme.js";
import { useAnimationTick } from "../hooks/use-animation-tick.js";

interface IThinkingIndicatorProps {
  /** Current tool activity (e.g. "Reading src/foo.ts") */
  readonly activity?: string | undefined;
  /** True when the model has started emitting text tokens */
  readonly isStreaming?: boolean | undefined;
  /** Model name for the attribution line */
  readonly modelName?: string | undefined;
  /** Timestamp (ms) when thinking began, for the elapsed counter */
  readonly startTime?: number | undefined;
}

const THINKING_PHRASES = [
  "Thinking",
  "Analyzing",
  "Reasoning",
  "Processing",
  "Understanding",
  "Considering",
  "Evaluating",
] as const;

const PHRASE_CYCLE_MS = 2500;

export function ThinkingIndicator({
  activity,
  isStreaming,
  modelName,
  startTime,
}: IThinkingIndicatorProps): React.ReactElement {
  const tick = useAnimationTick(1000);
  const elapsed = startTime === undefined ? 0 : Math.max(0, Date.now() - startTime);
  const phraseIndex = Math.floor(elapsed / PHRASE_CYCLE_MS) % THINKING_PHRASES.length;

  const elapsedStr = useMemo(() => {
    const secs = Math.floor(elapsed / 1000);
    if (secs < 1) return "";
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    return `${mins}m${secs % 60}s`;
  }, [elapsed]);

  const dotCount = tick % 4;
  const dots = ".".repeat(dotCount);
  const phrase = THINKING_PHRASES[phraseIndex] ?? "Thinking";

  const displayText = activity
    ? activity
    : isStreaming
      ? "Streaming response"
      : `${phrase}${dots}`;

  return (
    <Box flexDirection="column">
      {/* Model attribution */}
      {modelName ? (
        <Box>
          <Text color={colors.role.assistant} bold>
            {"\u2726"}{" "}
          </Text>
          <Text color={colors.role.assistant} bold>
            {modelName}
          </Text>
        </Box>
      ) : null}

      {/* Spinner + activity label + elapsed */}
      <Box marginLeft={2}>
        <GradientSpinner
          variant={activity ? "braille" : "dots"}
          label={displayText}
          labelColor={activity ? colors.text.secondary : colors.text.muted}
        />
        {elapsedStr ? (
          <Text color={colors.text.muted}> ({elapsedStr})</Text>
        ) : null}
      </Box>

      {/* Cancel hint */}
      <Box marginLeft={2}>
        <Text color={colors.text.muted} dimColor>
          {"  "}esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
