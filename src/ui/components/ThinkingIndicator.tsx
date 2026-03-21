/**
 * AI thinking / processing state visualization.
 * Shows animated spinner with cycling status phrases, elapsed time,
 * optional tool-activity description, and timer pause/resume support
 * for rate-limit waits.
 *
 * Inspired by Codex CLI's status indicator with inline layout:
 *   ● Working (12s • esc to interrupt)
 *     └ Reading src/foo.ts
 */

import React, { useMemo, useRef } from "react";
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
  /** True when paused (e.g. rate-limited) — freezes the elapsed timer */
  readonly isPaused?: boolean | undefined;
  /** Wrapped detail lines shown below the main status (e.g. background task info) */
  readonly details?: readonly string[] | undefined;
  /** Maximum detail lines to show before truncating (default: 3) */
  readonly maxDetailLines?: number | undefined;
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

/** Format elapsed milliseconds to compact string */
function formatElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 1) return "0s";
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return `${mins}m ${String(secs).padStart(2, "0")}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${String(remMins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
}

export function ThinkingIndicator({
  activity,
  isStreaming,
  modelName,
  startTime,
  isPaused = false,
  details,
  maxDetailLines = 3,
}: IThinkingIndicatorProps): React.ReactElement {
  const tick = useAnimationTick(1000);

  // Pause/resume: accumulate paused time so elapsed timer freezes during rate limits
  const pausedAccumRef = useRef(0);
  const pauseStartRef = useRef<number | undefined>(undefined);

  if (isPaused && pauseStartRef.current === undefined) {
    pauseStartRef.current = Date.now();
  } else if (!isPaused && pauseStartRef.current !== undefined) {
    pausedAccumRef.current += Date.now() - pauseStartRef.current;
    pauseStartRef.current = undefined;
  }

  const now = isPaused ? (pauseStartRef.current ?? Date.now()) : Date.now();
  const rawElapsed = startTime === undefined ? 0 : Math.max(0, now - startTime);
  const elapsed = Math.max(0, rawElapsed - pausedAccumRef.current);
  const phraseIndex = Math.floor(elapsed / PHRASE_CYCLE_MS) % THINKING_PHRASES.length;

  const elapsedStr = useMemo(() => {
    if (elapsed < 1000) return "";
    return formatElapsed(elapsed);
  }, [elapsed]);

  const dotCount = tick % 4;
  const dots = ".".repeat(dotCount);
  const phrase = THINKING_PHRASES[phraseIndex] ?? "Thinking";

  const displayText = isPaused
    ? "Rate limited — waiting"
    : activity
      ? activity
      : isStreaming
        ? "Streaming response"
        : `${phrase}${dots}`;

  // Truncate details to maxDetailLines
  const visibleDetails = details
    ? details.slice(0, maxDetailLines)
    : undefined;
  const hiddenDetailCount = details
    ? Math.max(0, details.length - maxDetailLines)
    : 0;

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

      {/* Inline status row: spinner + label + (elapsed • esc to interrupt) */}
      <Box marginLeft={2}>
        <GradientSpinner
          variant={isPaused ? "pulse" : activity ? "braille" : "dots"}
          label={displayText}
          labelColor={
            isPaused
              ? colors.status.warning
              : activity
                ? colors.text.secondary
                : colors.text.muted
          }
        />
        {elapsedStr ? (
          <Text color={colors.text.muted}>
            {" "}({elapsedStr} {"\u2022"} esc to interrupt)
          </Text>
        ) : (
          <Text color={colors.text.muted}>
            {" "}(esc to interrupt)
          </Text>
        )}
      </Box>

      {/* Wrapped detail lines with tree-branch prefix */}
      {visibleDetails && visibleDetails.length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          {visibleDetails.map((detail, i) => (
            <Text key={i} color={colors.text.muted} dimColor wrap="truncate">
              {"  \u2514 "}{detail}
            </Text>
          ))}
          {hiddenDetailCount > 0 ? (
            <Text color={colors.text.muted} dimColor>
              {"    "}(+{hiddenDetailCount} more)
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
