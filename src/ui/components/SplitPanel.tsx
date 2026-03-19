/**
 * Multi-model split panel layout for team mode.
 * Tab-based agent switching with color-coded streaming output,
 * tool call highlighting, gradient spinners, and activity status.
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { GradientSpinner } from "./GradientSpinner.js";
import { colors } from "../theme.js";
import type { IAgentState } from "../../types/index.js";

interface ISplitPanelProps {
  readonly agents: readonly IAgentState[];
  readonly activeAgentIndex: number;
  readonly onSelectAgent: (index: number) => void;
  readonly agentOutputs: ReadonlyMap<string, string>;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "active":
      return colors.status.success;
    case "idle":
      return colors.status.warning;
    case "error":
      return colors.status.error;
    case "shutdown":
      return colors.text.muted;
    default:
      return colors.text.primary;
  }
}

function shortModelLabel(model: string): string {
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("gpt-5")) return "GPT-5";
  if (model.includes("gemini") && model.includes("pro")) return "Gem-Pro";
  if (model.includes("gemini") && model.includes("flash")) return "Gem-Flash";
  if (model.includes("kimi") || model.includes("k2")) return "Kimi";
  const parts = model.split("-");
  return parts[parts.length - 1] ?? model.slice(0, 8);
}

function statusIndicator(status: string): string {
  switch (status) {
    case "active":
      return "\u25CF";
    case "idle":
      return "\u25CB";
    case "error":
      return "\u2716";
    default:
      return "\u2500";
  }
}

const MAX_OUTPUT_LINES = 40;

function classifyLine(
  line: string,
): "tool" | "result" | "error" | "text" | "empty" {
  if (line.length === 0) return "empty";
  if (line.startsWith("\u2699") || line.startsWith("\u2699\uFE0F"))
    return "tool";
  if (line.startsWith("  \u2192") || line.startsWith("  \u2192")) return "result";
  if (line.startsWith("Error:") || line.startsWith("Stream error:"))
    return "error";
  return "text";
}

function extractLastActivity(output: string): string | undefined {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const type = classifyLine(trimmed);
    if (type === "tool" || type === "result") return trimmed;
  }
  return undefined;
}

function AgentOutput({
  output,
  isActive,
}: {
  readonly output: string;
  readonly isActive: boolean;
}): React.ReactElement {
  const lines = output.split("\n");
  const truncated = lines.length > MAX_OUTPUT_LINES;
  const visible = truncated ? lines.slice(-MAX_OUTPUT_LINES) : lines;

  return (
    <Box flexDirection="column">
      {truncated ? (
        <Text color={colors.text.muted} dimColor>
          {"  "}({lines.length - MAX_OUTPUT_LINES} lines hidden)
        </Text>
      ) : null}
      {visible.map((line, i) => {
        const type = classifyLine(line);
        switch (type) {
          case "tool":
            return (
              <Text key={i} color={colors.role.tool}>
                {line}
              </Text>
            );
          case "result":
            return (
              <Text key={i} color={colors.text.muted}>
                {line}
              </Text>
            );
          case "error":
            return (
              <Text key={i} color={colors.status.error} bold>
                {line}
              </Text>
            );
          case "empty":
            return <Text key={i}>{" "}</Text>;
          default:
            return (
              <Text key={i} wrap="wrap">
                {line}
              </Text>
            );
        }
      })}
      {isActive ? (
        <Box marginTop={0}>
          <GradientSpinner variant="braille" label="Working\u2026" />
        </Box>
      ) : null}
    </Box>
  );
}

export function SplitPanel({
  agents,
  activeAgentIndex,
  onSelectAgent,
  agentOutputs,
}: ISplitPanelProps): React.ReactElement {
  useInput((input, key) => {
    if (key.tab) {
      onSelectAgent((activeAgentIndex + 1) % agents.length);
    }
    const numKey = parseInt(input, 10);
    if (
      !isNaN(numKey) &&
      numKey >= 1 &&
      numKey <= agents.length &&
      key.ctrl
    ) {
      onSelectAgent(numKey - 1);
    }
  });

  const activeAgent = agents[activeAgentIndex];
  const activeOutput = activeAgent
    ? agentOutputs.get(activeAgent.config.agentId) ?? ""
    : "";
  const lastActivity =
    activeOutput.length > 0 ? extractLastActivity(activeOutput) : undefined;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Tab bar */}
      <Box>
        {agents.map((agent, index) => {
          const isActive = index === activeAgentIndex;
          const sColor = getStatusColor(agent.status);
          const indicator = statusIndicator(agent.status);
          const modelShort = shortModelLabel(agent.config.model);
          const typeLabel =
            agent.config.agentType.charAt(0).toUpperCase() +
            agent.config.agentType.slice(1);
          return (
            <Box
              key={agent.config.agentId}
              borderStyle={isActive ? "bold" : "single"}
              borderColor={isActive ? colors.status.active : colors.border.dim}
              paddingX={1}
            >
              <Text color={sColor}>{indicator} </Text>
              <Text bold={isActive}>{typeLabel}</Text>
              <Text color={colors.text.muted} dimColor>
                {" "}
                {modelShort}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Keybinding hints */}
      <Box flexDirection="column" marginY={0}>
        <Box>
          <Text color={colors.text.muted}>{"  "}</Text>
          <Text color={colors.status.active} bold>Tab</Text>
          <Text color={colors.text.muted}> next agent  </Text>
          <Text color={colors.status.active} bold>Ctrl+1</Text>
          <Text color={colors.text.muted}>-</Text>
          <Text color={colors.status.active} bold>{agents.length}</Text>
          <Text color={colors.text.muted}> jump  </Text>
          <Text color={colors.status.warning} bold>/team stop</Text>
          <Text color={colors.text.muted}> exit team</Text>
        </Box>
        <Box>
          <Text color={colors.text.muted}>
            {"  "}Type below to send a message to the active agent
          </Text>
        </Box>
      </Box>

      {/* Active agent output */}
      <Box
        flexDirection="column"
        flexGrow={1}
        paddingX={1}
        marginTop={1}
        borderStyle="round"
        borderColor={colors.border.dim}
      >
        {activeAgent ? (
          <>
            <Box>
              <Text color={colors.status.active} bold>
                {"\u2726"} {activeAgent.config.name}
              </Text>
              <Text color={colors.text.muted}>
                {" "}
                {"\u2014"} {activeAgent.config.role}{" "}
              </Text>
              <Text color={getStatusColor(activeAgent.status)}>
                [{activeAgent.status}]
              </Text>
            </Box>
            {lastActivity ? (
              <Box>
                <Text color={colors.text.muted} dimColor>
                  {"  "}
                  {lastActivity.length > 80
                    ? lastActivity.slice(0, 80) + "\u2026"
                    : lastActivity}
                </Text>
              </Box>
            ) : null}
            <Box
              borderStyle="single"
              borderColor={colors.border.dim}
              borderTop
              borderBottom={false}
              borderLeft={false}
              borderRight={false}
              marginY={0}
            />

            {activeOutput.length > 0 ? (
              <Box flexDirection="column" marginTop={0}>
                <AgentOutput
                  output={activeOutput}
                  isActive={activeAgent.status === "active"}
                />
              </Box>
            ) : activeAgent.status === "active" ? (
              <Box marginTop={1}>
                <GradientSpinner
                  variant="dots"
                  label="Initializing agent\u2026"
                />
              </Box>
            ) : (
              <Text color={colors.status.warning}>
                {"\u231B"} Waiting for task\u2026
              </Text>
            )}
          </>
        ) : (
          <Text color={colors.text.muted}>No agents active</Text>
        )}
      </Box>
    </Box>
  );
}
