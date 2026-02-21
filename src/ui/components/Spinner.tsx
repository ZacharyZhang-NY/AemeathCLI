/**
 * Loading indicator component per PRD section 6.2
 *
 * Uses a slow-cycling static indicator instead of rapid-frame animation
 * to prevent terminal flashing/flickering in split-pane layouts.
 */

import React, { useState, useEffect } from "react";
import { Text } from "ink";

interface ISpinnerProps {
  readonly label?: string;
}

const SPINNER_FRAMES = ["\u25CB", "\u25D4", "\u25D1", "\u25D5", "\u25CF", "\u25D5", "\u25D1", "\u25D4"];
const SPINNER_INTERVAL_MS = 300;

export function Spinner({ label }: ISpinnerProps): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text>
      <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>
      {label ? <Text> {label}</Text> : null}
    </Text>
  );
}
