/**
 * Status bar component per PRD section 18.4
 * Shows: tool name, active model, role, token count, cost, git branch
 */

import React from "react";
import { Box, Text } from "ink";

interface IStatusBarProps {
  readonly model: string;
  readonly role?: string | undefined;
  readonly tokenCount: string;
  readonly cost: string;
  readonly gitBranch?: string | undefined;
  readonly gitChanges?: number | undefined;
}

/** Shorten model ID for the status bar: "claude-sonnet-4-6" → "Sonnet 4.6" */
function shortModelLabel(model: string): string {
  if (model.includes("opus")) return "Opus 4.6";
  if (model.includes("sonnet")) return "Sonnet 4.6";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model.includes("gpt-5.2-mini")) return "GPT-5.2m";
  if (model.includes("gpt-5.2")) return "GPT-5.2";
  if (model.includes("o3")) return "o3";
  if (model.includes("gemini") && model.includes("pro")) return "Gem Pro";
  if (model.includes("gemini") && model.includes("flash")) return "Gem Flash";
  if (model.includes("kimi") || model.includes("k2")) return "Kimi";
  return model;
}

export function StatusBar({
  model,
  role,
  tokenCount,
  cost,
  gitBranch,
  gitChanges,
}: IStatusBarProps): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="cyan" bold>
        {"\u2726"} aemeathcli
      </Text>
      <Text color="gray"> {"\u2502"} </Text>
      <Text color="yellow" bold>{shortModelLabel(model)}</Text>
      {role ? (
        <>
          <Text color="gray"> {"\u2502"} </Text>
          <Text color="magenta">{role}</Text>
        </>
      ) : null}
      <Text color="gray"> {"\u2502"} </Text>
      <Text>{tokenCount} tok</Text>
      <Text color="gray"> {"\u2502"} </Text>
      <Text color="green">{cost}</Text>
      {gitBranch ? (
        <>
          <Text color="gray"> {"\u2502"} </Text>
          <Text color="blue">
            {"\u2387"} {gitBranch}
            {gitChanges !== undefined && gitChanges > 0 ? ` \u00B1${gitChanges}` : ""}
          </Text>
        </>
      ) : null}
    </Box>
  );
}
