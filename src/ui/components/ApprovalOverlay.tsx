/**
 * Modal overlay for tool execution approval.
 *
 * Presents a bordered approval dialog with type-specific previews
 * (diff, command, URL), keyboard shortcuts for allow/deny decisions,
 * and an optional pending-queue counter.
 */

import React, { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { BRAND_COLOR, colors } from "../theme.js";
import { DiffRenderer } from "./DiffRenderer.js";

// ── Types ────────────────────────────────────────────────────────────────

/** Categories of operations that can require approval. */
type ApprovalType = "exec" | "write" | "edit" | "delete" | "network";

/** A pending approval request with type-specific metadata. */
interface IApprovalRequest {
  readonly id: string;
  readonly type: ApprovalType;
  readonly title: string;
  readonly description: string;
  /** For file operations: the diff to preview. */
  readonly diff?: string;
  /** For exec: the command to run. */
  readonly command?: string;
  /** For network: the URL. */
  readonly url?: string;
}

/** The user's decision on an approval request. */
type ApprovalDecision = "allow" | "deny" | "allow-session" | "allow-always";

/** Props for the ApprovalOverlay component. */
interface IApprovalOverlayProps {
  readonly request: IApprovalRequest;
  readonly onDecision: (decision: ApprovalDecision) => void;
  /** Queue count (how many more pending). */
  readonly queueCount?: number;
}

// ── Lookup tables ────────────────────────────────────────────────────────

const TYPE_ICON: Readonly<Record<ApprovalType, string>> = {
  exec: "\u26A1",
  write: "\u270F\uFE0F",
  edit: "\u{1F4DD}",
  delete: "\u{1F5D1}\uFE0F",
  network: "\u{1F310}",
};

const TYPE_LABEL: Readonly<Record<ApprovalType, string>> = {
  exec: "Command Execution",
  write: "File Write",
  edit: "File Edit",
  delete: "File Delete",
  network: "Network Request",
};

const BORDER_COLOR: Readonly<Record<ApprovalType, string>> = {
  delete: colors.status.error,
  exec: colors.status.warning,
  network: colors.status.info,
  write: BRAND_COLOR,
  edit: BRAND_COLOR,
};

const COLOR_ALLOW = "#4ade80";
const COLOR_DENY = "#f87171";
const SEP_WIDTH = 60;

// ── Shortcut bar item ────────────────────────────────────────────────────

function ShortcutHint({ k, desc, c }: {
  readonly k: string;
  readonly desc: string;
  readonly c: string;
}): React.ReactElement {
  return (
    <Box marginRight={2}>
      <Text color={c} bold>[{k}]</Text>
      <Text color={colors.text.secondary}> {desc}</Text>
    </Box>
  );
}

// ── Main component ───────────────────────────────────────────────────────

/**
 * Render a modal approval overlay for a pending tool execution request.
 *
 * Keyboard shortcuts:
 * - `y` / Enter -- allow once
 * - `n` / Esc   -- deny
 * - `a`         -- allow for session
 * - `!`         -- allow always
 */
export function ApprovalOverlay({
  request,
  onDecision,
  queueCount,
}: IApprovalOverlayProps): React.ReactElement {
  const decide = useCallback(
    (d: ApprovalDecision) => { onDecision(d); },
    [onDecision],
  );

  useInput((input, key) => {
    if (input === "n" || key.escape) { decide("deny"); return; }
    if (input === "y" || key.return) { decide("allow"); return; }
    if (input === "a") { decide("allow-session"); return; }
    if (input === "!") { decide("allow-always"); return; }
  });

  const borderColor = BORDER_COLOR[request.type];
  const hasQueue = queueCount !== undefined && queueCount > 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor}
      paddingX={1} paddingY={1} marginY={1}>
      {/* Title bar */}
      <Box>
        <Text color={borderColor} bold>
          {TYPE_ICON[request.type]} {TYPE_LABEL[request.type]}
        </Text>
        <Text color={colors.text.muted}>{" \u2502 "}</Text>
        <Text color={colors.text.primary} bold>{request.title}</Text>
        {hasQueue ? (
          <Text color={colors.text.muted} dimColor>
            {"  "}(+{queueCount} more pending)
          </Text>
        ) : null}
      </Box>

      <Box marginY={1}>
        <Text color={colors.border.dim}>{"\u2500".repeat(SEP_WIDTH)}</Text>
      </Box>

      {/* Description */}
      <Box paddingX={1}>
        <Text color={colors.text.secondary} wrap="wrap">{request.description}</Text>
      </Box>

      {/* Command preview */}
      {request.command !== undefined ? (
        <Box flexDirection="column" borderStyle="single" borderColor={colors.border.dim}
          paddingX={1} marginX={1} marginY={1}>
          <Text color={colors.text.muted} dimColor>Command:</Text>
          <Text color={colors.text.primary} bold>{"$ "}{request.command}</Text>
        </Box>
      ) : null}

      {/* URL preview */}
      {request.url !== undefined ? (
        <Box flexDirection="column" borderStyle="single" borderColor={colors.border.dim}
          paddingX={1} marginX={1} marginY={1}>
          <Text color={colors.text.muted} dimColor>URL:</Text>
          <Text color={colors.status.info} bold>{request.url}</Text>
        </Box>
      ) : null}

      {/* Diff preview */}
      {request.diff !== undefined ? (
        <Box paddingX={1}>
          <DiffRenderer filePath={request.title} diff={request.diff} maxLines={30} />
        </Box>
      ) : null}

      <Box marginY={1}>
        <Text color={colors.border.dim}>{"\u2500".repeat(SEP_WIDTH)}</Text>
      </Box>

      {/* Keyboard shortcuts */}
      <Box paddingX={1} flexWrap="wrap">
        <ShortcutHint k="y" desc="allow" c={COLOR_ALLOW} />
        <ShortcutHint k="n" desc="deny" c={COLOR_DENY} />
        <ShortcutHint k="a" desc="allow session" c={BRAND_COLOR} />
        <ShortcutHint k="!" desc="allow always" c={colors.status.warning} />
      </Box>
    </Box>
  );
}

export type {
  ApprovalType,
  IApprovalRequest,
  ApprovalDecision,
  IApprovalOverlayProps,
};
