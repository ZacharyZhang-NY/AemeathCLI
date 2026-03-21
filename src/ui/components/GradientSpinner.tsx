/**
 * Animated spinner with multiple style variants and optional shimmer effect.
 * The shimmer creates a time-synchronized light sweep across the label text,
 * matching the polish of Codex CLI's status indicators.
 */

import React, { useMemo } from "react";
import { Text } from "ink";
import { BRAND_COLOR } from "../theme.js";
import { useAnimationTick } from "../hooks/use-animation-tick.js";
import { shimmerToInkSpans } from "../shimmer.js";

interface IGradientSpinnerProps {
  /** Text displayed after the spinner character */
  readonly label?: string | undefined;
  /** Label color override (defaults to secondary text) */
  readonly labelColor?: string | undefined;
  /** Spinner animation style */
  readonly variant?: "dots" | "braille" | "arc" | "pulse" | "bounce" | undefined;
  /** Per-frame interval override in ms */
  readonly speed?: number | undefined;
  /** Enable shimmer sweep effect on the label text (default: false) */
  readonly shimmer?: boolean | undefined;
}

const SPINNER_VARIANTS: Record<
  string,
  { readonly frames: readonly string[]; readonly interval: number }
> = {
  dots: {
    frames: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"],
    interval: 120,
  },
  braille: {
    frames: ["\u28FE", "\u28FD", "\u28FB", "\u28BF", "\u287F", "\u28DF", "\u28EF", "\u28F7"],
    interval: 120,
  },
  arc: {
    frames: ["\u25DC", "\u25E0", "\u25DD", "\u25DE", "\u25E1", "\u25DF"],
    interval: 100,
  },
  pulse: {
    frames: ["\u25C9", "\u25CE", "\u25CB", "\u25CE", "\u25C9", "\u25CF"],
    interval: 120,
  },
  bounce: {
    frames: ["\u2801", "\u2802", "\u2804", "\u2840", "\u2880", "\u2820", "\u2810", "\u2808"],
    interval: 120,
  },
};

/** Shimmer refresh rate — 32ms ≈ 30fps for smooth sweep animation */
const SHIMMER_INTERVAL_MS = 32;

export function GradientSpinner({
  label,
  labelColor = "#888888",
  variant = "dots",
  speed,
  shimmer = false,
}: IGradientSpinnerProps): React.ReactElement {
  const spinnerDef = SPINNER_VARIANTS[variant] ?? SPINNER_VARIANTS["dots"];
  if (!spinnerDef) {
    throw new Error("Missing default spinner configuration");
  }
  const interval = speed ?? spinnerDef.interval;
  const tick = useAnimationTick(interval);
  // Drive shimmer redraws at a faster rate for smooth animation
  useAnimationTick(SHIMMER_INTERVAL_MS, shimmer && label !== undefined && label.length > 0);
  const frame = tick % spinnerDef.frames.length;

  // Compute shimmer spans when enabled
  const shimmerSpans = useMemo(() => {
    if (!shimmer || !label) return null;
    return shimmerToInkSpans(label, labelColor);
  }, [shimmer, label, labelColor, tick]);

  return (
    <Text>
      <Text color={BRAND_COLOR}>{spinnerDef.frames[frame]}</Text>
      {label ? (
        shimmerSpans ? (
          <Text>
            {" "}
            {shimmerSpans.map((span, i) => (
              <Text
                key={i}
                color={span.color}
                bold={span.bold}
                dimColor={span.dim}
              >
                {span.text}
              </Text>
            ))}
          </Text>
        ) : (
          <Text color={labelColor}> {label}</Text>
        )
      ) : null}
    </Text>
  );
}
