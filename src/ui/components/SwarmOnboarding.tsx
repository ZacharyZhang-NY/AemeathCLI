import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import type { CliProviderType } from "../../orchestrator/constants.js";
import { getCliProviderEntry } from "../../orchestrator/utils/provider-catalog.js";
import { colors } from "../theme.js";

interface ISwarmOnboardingProps {
  readonly detectedProviders: readonly CliProviderType[];
  readonly currentPrimaryProvider?: CliProviderType | undefined;
  readonly onSelect: (provider: CliProviderType) => void;
  readonly onSkip: () => void;
}

export function SwarmOnboarding({
  detectedProviders,
  currentPrimaryProvider,
  onSelect,
  onSkip,
}: ISwarmOnboardingProps): React.ReactElement {
  const entries = useMemo(
    () => detectedProviders.map((provider) => getCliProviderEntry(provider)),
    [detectedProviders],
  );

  const initialCursor = useMemo(() => {
    if (!currentPrimaryProvider) {
      return 0;
    }

    const currentIndex = detectedProviders.indexOf(currentPrimaryProvider);
    return currentIndex >= 0 ? currentIndex : 0;
  }, [currentPrimaryProvider, detectedProviders]);

  const [cursor, setCursor] = useState(initialCursor);

  useInput((_input, key) => {
    if (entries.length === 0) {
      if (key.return || key.escape) {
        onSkip();
      }
      return;
    }

    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : entries.length - 1));
      return;
    }

    if (key.downArrow) {
      setCursor((prev) => (prev < entries.length - 1 ? prev + 1 : 0));
      return;
    }

    if (key.return) {
      const selected = detectedProviders[cursor];
      if (selected) {
        onSelect(selected);
      }
      return;
    }

    if (key.escape && entries.length === 0) {
      onSkip();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text color={colors.status.active} bold>
          Swarm Setup
        </Text>
        <Text color={colors.text.muted}>
          Select the master agent provider for swarm orchestration.
        </Text>
      </Box>

      {entries.length > 0 ? (
        <>
          {entries.map((entry, index) => {
            const isSelected = index === cursor;
            const isCurrent = currentPrimaryProvider === entry.type;
            return (
              <Box key={entry.type}>
                <Text
                  color={isSelected ? colors.status.success : colors.text.primary}
                  bold={isSelected}
                >
                  {isSelected ? "\u25B8 " : "  "}
                  {entry.label.padEnd(16)}
                </Text>
                <Text color={colors.text.muted}>
                  {entry.description}
                  {isCurrent ? " (current)" : ""}
                </Text>
              </Box>
            );
          })}

          <Box marginTop={1} flexDirection="column">
            <Text color={colors.text.muted}>
              Enter sets the master agent. Remaining detected providers become fallbacks.
            </Text>
            <Text color={colors.text.muted}>
              \u2191\u2193 navigate · Enter confirm
            </Text>
          </Box>
        </>
      ) : (
        <Box flexDirection="column">
          <Text color={colors.status.warning}>
            No supported native agent CLI was detected.
          </Text>
          <Text color={colors.text.muted}>
            Install Claude Code, Codex, Gemini CLI, Kimi CLI, or Ollama, then restart.
          </Text>
          <Box marginTop={1}>
            <Text color={colors.text.muted}>
              Enter or Esc continues without swarm setup.
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
