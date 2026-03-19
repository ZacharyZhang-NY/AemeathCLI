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
  { key: "Shift+Tab", desc: "Cycle swarm/edit/chat modes" },
  { key: "Tab", desc: "Autocomplete or focus next agent" },
  { key: "@", desc: "Reference project files" },
  { key: "$skill", desc: "Invoke skills" },
] as const;

const TIP_ROWS = [TIPS.slice(0, 2), TIPS.slice(2, 4), TIPS.slice(4)] as const;

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
      marginBottom={1}
    >
      {/* Mascot (left) + Logo (right), vertically centered via alignItems */}
      <Box alignItems="center">
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
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color={colors.text.secondary} bold>
            Quick Start
          </Text>
        </Box>
        {TIP_ROWS.map((row, rowIndex) => (
          <Box key={`tip-row-${rowIndex}`}>
            {row.map((tip, tipIndex) => (
              <Box
                key={tip.key}
                flexDirection="column"
                width={40}
                marginRight={tipIndex < row.length - 1 ? 3 : 0}
              >
                <Text color={colors.status.active} bold>
                  {tip.key}
                </Text>
                <Text color={colors.text.muted}>{tip.desc}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>

    </Box>
  );
}
