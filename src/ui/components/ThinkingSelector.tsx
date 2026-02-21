/**
 * Interactive thinking-level selector with up/down arrow key navigation.
 * Shows provider-specific thinking options for the selected model.
 * Page 2 of the /model selection flow.
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { getThinkingConfigForModel } from "../../types/model.js";

interface IThinkingSelectorProps {
  readonly modelId: string;
  readonly modelName: string;
  readonly currentValue: string;
  readonly onSelect: (value: string) => void;
  readonly onBack: () => void;
}

function formatMethod(method: string): string {
  switch (method) {
    case "extended_thinking": return "Extended Thinking";
    case "reasoning_effort": return "Reasoning Effort";
    case "thinking_budget": return "Thinking Budget";
    case "thinking_level": return "Thinking Level";
    case "thinking_mode": return "Thinking Mode";
    default: return "Thinking";
  }
}

export function ThinkingSelector({
  modelId,
  modelName,
  currentValue,
  onSelect,
  onBack,
}: IThinkingSelectorProps): React.ReactElement {
  const config = useMemo(() => getThinkingConfigForModel(modelId), [modelId]);

  const initialIdx = useMemo(() => {
    if (!config) return 0;
    const idx = config.options.findIndex((o) => o.value === currentValue);
    if (idx >= 0) return idx;
    const defaultIdx = config.options.findIndex((o) => o.value === config.defaultValue);
    return Math.max(0, defaultIdx);
  }, [config, currentValue]);

  const [cursor, setCursor] = useState(initialIdx);

  useInput((_input, key) => {
    if (!config) {
      if (key.return || key.escape) onBack();
      return;
    }
    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : config.options.length - 1));
    } else if (key.downArrow) {
      setCursor((prev) => (prev < config.options.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const option = config.options[cursor];
      if (option) onSelect(option.value);
    } else if (key.escape) {
      onBack();
    }
  });

  if (!config) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">No thinking options available for {modelName}.</Text>
        <Text color="gray">Press Enter or Esc to continue.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="cyan">{formatMethod(config.method)}</Text>
        <Text color="gray">  Model: {modelName}  (up/down navigate, Enter select, Esc back)</Text>
      </Box>
      {config.options.map((option, idx) => {
        const isHighlighted = cursor === idx;
        const isCurrent = option.value === currentValue;
        const currentTag = isCurrent ? " (current)" : "";
        return (
          <Box key={option.value}>
            <Text {...(isHighlighted ? { color: "green" } : {})} bold={isHighlighted}>
              {isHighlighted ? "> " : "  "}{option.label.padEnd(22)}
            </Text>
            <Text color="gray"> {option.description}{currentTag}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
