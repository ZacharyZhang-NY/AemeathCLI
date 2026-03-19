/**
 * ASCII art welcome screen with mascot and flat brand colors.
 * Shown on first launch before any messages are sent.
 */

import React from "react";
import { Box, Text } from "ink";
import { BRAND_COLOR, colors } from "../theme.js";

interface IWelcomeScreenProps {
  readonly version?: string | undefined;
}

const MASCOT_LINES = [
  "                    ",
  "         :-         ",
  "      ::::::::      ",
  "    .:.:::.::::     ",
  "     ::--:::-:: ::  ",
  "     -:##**%%:-     ",
  "      :=+==++: :    ",
  "     ::==++=-:.     ",
  "-:-=*:----:=-::*==:-",
  "  =    -::::-    -  ",
] as const;

const LOGO_LINES = [
  " \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2554\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D\u2588\u2588\u2551  \u2588\u2588\u2551",
  "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551",
  "\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2551\u2554\u2588\u2588\u2554\u255D\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551",
  "\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551 \u2554\u2550\u255D \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551  \u2588\u2588\u2551",
  "\u2554\u2550\u255D  \u2554\u2550\u255D\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u2554\u2550\u255D     \u2554\u2550\u255D\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u2554\u2550\u255D  \u2554\u2550\u255D   \u2554\u2550\u255D   \u2554\u2550\u255D  \u2554\u2550\u255D",
] as const;

const TIPS = [
  { key: "/help", desc: "Show all commands" },
  { key: "/model", desc: "Switch AI model" },
  { key: "Tab", desc: "Autocomplete" },
  { key: "@file", desc: "Reference files" },
  { key: "$skill", desc: "Invoke skills" },
] as const;

export function WelcomeScreen({
  version,
}: IWelcomeScreenProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      paddingX={2}
      justifyContent="center"
      alignItems="center"
    >
      {/* Mascot (left) + Logo (right), vertically centered via alignItems */}
      <Box alignItems="center" marginBottom={1}>
        <Box flexDirection="column" marginRight={2}>
          {MASCOT_LINES.map((line, i) => (
            <Text key={`m${i}`} color={BRAND_COLOR}>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column">
          {LOGO_LINES.map((line, i) => (
            <Text key={i} color={BRAND_COLOR}>{line}</Text>
          ))}
        </Box>
      </Box>

      {/* Tagline divider — centered below */}
      <Box marginBottom={0}>
        <Text color={colors.border.active}>
          {"\u2500".repeat(16)}{" "}
        </Text>
        <Text color={colors.text.accent} bold>
          Aemeath Agent Swarm
        </Text>
        <Text color={colors.border.active}>
          {" "}{"\u2500".repeat(16)}
        </Text>
      </Box>

      {/* Version — centered */}
      {version ? (
        <Box>
          <Text color={colors.text.muted}>v{version}</Text>
        </Box>
      ) : null}

      {/* Quick-start tips */}
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text color={colors.text.secondary} bold>
            Quick Start
          </Text>
        </Box>
        {TIPS.map((tip) => (
          <Box key={tip.key}>
            <Text color={colors.status.active} bold>
              {"  "}
              {tip.key.padEnd(12)}
            </Text>
            <Text color={colors.text.muted}>{tip.desc}</Text>
          </Box>
        ))}
      </Box>

      {/* Bottom prompt hint */}
      <Box marginTop={2}>
        <Text color={colors.text.muted}>
          Type a message to begin, or press{" "}
        </Text>
        <Text color={colors.text.accent} bold>
          /
        </Text>
        <Text color={colors.text.muted}> for commands</Text>
      </Box>
    </Box>
  );
}
