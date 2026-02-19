/**
 * Loading indicator component per PRD section 6.2
 */

import React from "react";
import { Text } from "ink";
import InkSpinner from "ink-spinner";

interface ISpinnerProps {
  readonly label?: string;
}

export function Spinner({ label }: ISpinnerProps): React.ReactElement {
  return (
    <Text>
      <Text color="cyan">
        <InkSpinner type="dots" />
      </Text>
      {label ? <Text> {label}</Text> : null}
    </Text>
  );
}
