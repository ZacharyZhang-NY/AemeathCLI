/**
 * Unicode progress bar with flat brand color fill.
 * Supports determinate (percentage) and indeterminate (bouncing highlight) modes.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { BRAND_COLOR, colors } from "../theme.js";

interface IProgressBarProps {
  /** Progress 0-100 for determinate mode; omit for indeterminate. */
  readonly progress?: number | undefined;
  /** Bar width in characters (default 20). */
  readonly width?: number | undefined;
  /** Label text before the bar. */
  readonly label?: string | undefined;
  /** Show percentage after the bar. */
  readonly showPercent?: boolean | undefined;
}

const FILL = "\u2588";
const EMPTY = "\u2591";

export function ProgressBar({
  progress,
  width = 20,
  label,
  showPercent = true,
}: IProgressBarProps): React.ReactElement {
  const [bounceTick, setBounceTick] = useState(0);

  useEffect(() => {
    if (progress !== undefined) return;
    const timer = setInterval(() => {
      setBounceTick((prev) => (prev + 1) % (width * 2));
    }, 80);
    return () => {
      clearInterval(timer);
    };
  }, [progress, width]);

  if (progress !== undefined) {
    const clamped = Math.max(0, Math.min(100, progress));
    const fillCount = Math.round((clamped / 100) * width);
    const emptyCount = width - fillCount;

    return (
      <Box>
        {label ? (
          <Text color={colors.text.secondary}>{label} </Text>
        ) : null}
        <Text color={BRAND_COLOR}>{FILL.repeat(fillCount)}</Text>
        <Text color={colors.border.dim}>{EMPTY.repeat(emptyCount)}</Text>
        {showPercent ? (
          <Text color={colors.text.muted}> {Math.round(clamped)}%</Text>
        ) : null}
      </Box>
    );
  }

  // Indeterminate — bouncing 3-char highlight
  const bounceWidth = 3;
  const maxPos = width - bounceWidth;
  const rawPos = bounceTick % (maxPos * 2);
  const pos = rawPos <= maxPos ? rawPos : maxPos * 2 - rawPos;

  return (
    <Box>
      {label ? (
        <Text color={colors.text.secondary}>{label} </Text>
      ) : null}
      <Text>
        {Array.from({ length: width }, (_, i) => {
          if (i >= pos && i < pos + bounceWidth) {
            return (
              <Text key={i} color={BRAND_COLOR}>
                {FILL}
              </Text>
            );
          }
          return (
            <Text key={i} color={colors.border.dim}>
              {EMPTY}
            </Text>
          );
        })}
      </Text>
    </Box>
  );
}
