/**
 * Interactive provider login selector with up/down arrow key navigation.
 * Shows available providers, user selects one, then browser login is triggered.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface ILoginSelectorProps {
  readonly onSelect: (provider: string) => void;
  readonly onCancel: () => void;
}

interface IProviderChoice {
  readonly label: string;
  readonly value: string;
  readonly description: string;
}

const PROVIDERS: readonly IProviderChoice[] = [
  { label: "Claude", value: "claude", description: "Anthropic — Claude models" },
  { label: "Codex", value: "codex", description: "OpenAI — GPT / Codex models" },
  { label: "Gemini", value: "gemini", description: "Google — Gemini models" },
  { label: "Kimi", value: "kimi", description: "Moonshot — Kimi models" },
];

export function LoginSelector({ onSelect, onCancel }: ILoginSelectorProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : PROVIDERS.length - 1));
    } else if (key.downArrow) {
      setCursor((prev) => (prev < PROVIDERS.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const selected = PROVIDERS[cursor];
      if (selected) onSelect(selected.value);
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Select a provider to log in to</Text>
        <Text color="gray">  (up/down navigate, Enter select, Esc cancel)</Text>
      </Box>
      {PROVIDERS.map((provider, idx) => {
        const isHighlighted = cursor === idx;
        return (
          <Box key={provider.value}>
            <Text {...(isHighlighted ? { color: "green" } : {})} bold={isHighlighted}>
              {isHighlighted ? "> " : "  "}{provider.label.padEnd(12)}
            </Text>
            <Text color="gray"> {provider.description}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray">  Login will open your browser for authentication.</Text>
      </Box>
    </Box>
  );
}
