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

export function StatusBar({
  model,
  role,
  tokenCount,
  cost,
  gitBranch,
  gitChanges,
}: IStatusBarProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="cyan" bold>
        aemeathcli
      </Text>
      <Text color="gray"> | </Text>
      <Text color="yellow">{model}</Text>
      {role ? (
        <>
          <Text color="gray"> | </Text>
          <Text color="magenta">{role}</Text>
        </>
      ) : null}
      <Text color="gray"> | </Text>
      <Text>{tokenCount} tokens</Text>
      <Text color="gray"> | </Text>
      <Text color="green">{cost}</Text>
      {gitBranch ? (
        <>
          <Text color="gray"> | </Text>
          <Text color="blue">
            {gitBranch}
            {gitChanges !== undefined && gitChanges > 0 ? ` ±${gitChanges}` : ""}
          </Text>
        </>
      ) : null}
    </Box>
  );
}
