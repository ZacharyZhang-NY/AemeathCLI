/**
 * Status bar with flat brand color, model/role/token/cost display,
 * and git branch indicator.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { BRAND_COLOR, colors } from "../theme.js";

interface IStatusBarProps {
  readonly model: string;
  readonly role?: string | undefined;
  readonly tokenCount: string;
  readonly cost: string;
  readonly gitBranch?: string | undefined;
  readonly gitChanges?: number | undefined;
}

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

const SEP = " \u2502 ";

export function StatusBar({
  model,
  role,
  tokenCount,
  cost,
  gitBranch,
  gitChanges,
}: IStatusBarProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = (stdout.columns as number | undefined) ?? 120;

  // Progressive collapsing based on terminal width:
  //   > 100 : everything visible
  //   > 80  : drop role
  //   > 60  : drop git info
  //   > 45  : drop token count
  //   <= 45 : brand + model only
  const showRole = width > 100 && !!role;
  const showGit = width > 60 && !!gitBranch;
  const showTokens = width > 45;
  const showCost = width > 45;

  return (
    <Box borderStyle="round" borderColor={colors.border.dim} paddingX={1}>
      <Text color={BRAND_COLOR} bold>
        {"\u25C6"}{" "}
      </Text>
      <Text color={colors.status.active} bold>
        Aemeath Agent Swarm
      </Text>

      <Text color={colors.text.muted}>{SEP}</Text>
      <Text color={colors.status.warning} bold>
        {shortModelLabel(model)}
      </Text>

      {showRole ? (
        <>
          <Text color={colors.text.muted}>{SEP}</Text>
          <Text color={colors.role.tool}>{role}</Text>
        </>
      ) : null}

      {showTokens ? (
        <>
          <Text color={colors.text.muted}>{SEP}</Text>
          <Text color={colors.text.secondary}>{tokenCount} tok</Text>
        </>
      ) : null}

      {showCost ? (
        <>
          <Text color={colors.text.muted}>{SEP}</Text>
          <Text color={colors.status.success}>{cost}</Text>
        </>
      ) : null}

      {showGit ? (
        <>
          <Text color={colors.text.muted}>{SEP}</Text>
          <Text color={colors.status.info}>
            {"\u2387"} {gitBranch}
            {gitChanges !== undefined && gitChanges > 0
              ? ` \u00B1${gitChanges}`
              : ""}
          </Text>
        </>
      ) : null}
    </Box>
  );
}
