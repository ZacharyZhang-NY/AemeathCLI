/**
 * Loading indicator component — backward-compatible wrapper
 * around the new GradientSpinner with smooth color cycling.
 */

import React from "react";
import { GradientSpinner } from "./GradientSpinner.js";

interface ISpinnerProps {
  readonly label?: string;
  readonly variant?: "dots" | "braille" | "arc" | "pulse" | "bounce";
}

export function Spinner({ label, variant = "dots" }: ISpinnerProps): React.ReactElement {
  return <GradientSpinner label={label} variant={variant} />;
}
