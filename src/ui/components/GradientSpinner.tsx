/**
 * Animated spinner with multiple style variants.
 * Uses a single flat brand color — no gradients.
 */

import React from "react";
import { Text } from "ink";
import { BRAND_COLOR } from "../theme.js";
import { useAnimationTick } from "../hooks/use-animation-tick.js";

interface IGradientSpinnerProps {
  /** Text displayed after the spinner character */
  readonly label?: string | undefined;
  /** Label color override (defaults to secondary text) */
  readonly labelColor?: string | undefined;
  /** Spinner animation style */
  readonly variant?: "dots" | "braille" | "arc" | "pulse" | "bounce" | undefined;
  /** Per-frame interval override in ms */
  readonly speed?: number | undefined;
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

export function GradientSpinner({
  label,
  labelColor = "#888888",
  variant = "dots",
  speed,
}: IGradientSpinnerProps): React.ReactElement {
  const spinnerDef = SPINNER_VARIANTS[variant] ?? SPINNER_VARIANTS["dots"];
  if (!spinnerDef) {
    throw new Error("Missing default spinner configuration");
  }
  const interval = speed ?? spinnerDef.interval;
  const tick = useAnimationTick(interval);
  const frame = tick % spinnerDef.frames.length;

  return (
    <Text>
      <Text color={BRAND_COLOR}>{spinnerDef.frames[frame]}</Text>
      {label ? <Text color={labelColor}> {label}</Text> : null}
    </Text>
  );
}
