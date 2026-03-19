/**
 * Multi-agent hub-and-spoke layout for fallback TUI mode.
 * The sponsoring master agent stays on the left half, while worker agents
 * remain visible in a stacked right column.
 */

import React from "react";
import { Box, Text, useInput } from "ink";
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

function classifyLine(
  line: string,
): "tool" | "result" | "error" | "text" | "empty" {
  if (line.length === 0) return "empty";
  if (line.startsWith("\u2699") || line.startsWith("\u2699\uFE0F")) return "tool";
  if (line.startsWith("  \u2192")) return "result";
  if (line.startsWith("Error:") || line.startsWith("Stream error:")) return "error";
  return "text";
}

function renderLine(line: string, key: string): React.ReactElement {
  const type = classifyLine(line);
  switch (type) {
    case "tool":
      return (
        <Text key={key} color={colors.role.tool}>
          {line}
        </Text>
      );
    case "result":
      return (
        <Text key={key} color={colors.text.muted}>
          {line}
        </Text>
      );
    case "error":
      return (
        <Text key={key} color={colors.status.error} bold>
          {line}
        </Text>
      );
    case "empty":
      return <Text key={key}>{" "}</Text>;
    default:
      return (
        <Text key={key} wrap="wrap">
          {line}
        </Text>
      );
  }
}

interface IVisibleLine {
  readonly absoluteIndex: number;
  readonly content: string;
}

function getVisibleLines(output: string, maxLines: number): readonly IVisibleLine[] {
  const lines = output.split("\n");
  const startIndex = Math.max(0, lines.length - maxLines);
  return lines.slice(startIndex).map((content, index) => ({
    absoluteIndex: startIndex + index,
    content,
  }));
}

function getLastActivity(output: string): string | undefined {
  const lines = output.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!line) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const type = classifyLine(trimmed);
    if (type === "tool" || type === "result" || type === "error") {
      return trimmed;
    }
  }
  return undefined;
}

function AgentFrameComponent({
  agent,
  output,
  titlePrefix,
  isFocused,
  maxLines,
}: {
  readonly agent: IAgentState;
  readonly output: string;
  readonly titlePrefix: string;
  readonly isFocused: boolean;
  readonly maxLines: number;
}): React.ReactElement {
  const previewLines = React.useMemo(
    () => getVisibleLines(output, maxLines),
    [maxLines, output],
  );
  const lastActivity = React.useMemo(
    () => getLastActivity(output),
    [output],
  );

  return (
    <Box
      flexDirection="column"
      borderStyle={isFocused ? "round" : "single"}
      borderColor={isFocused ? colors.status.active : colors.border.dim}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Box>
        <Text color={getStatusColor(agent.status)}>{statusIndicator(agent.status)} </Text>
        <Text color={colors.status.active} bold>
          {titlePrefix} {agent.config.name}
        </Text>
        <Text color={colors.text.muted}>
          {" "}
          {"\u2014"} {agent.config.role} {"\u00B7"} {shortModelLabel(agent.config.model)}
        </Text>
      </Box>
      {lastActivity ? (
        <Box>
          <Text color={colors.text.muted} dimColor>
            {lastActivity.length > 72 ? `${lastActivity.slice(0, 72)}\u2026` : lastActivity}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {previewLines.length > 0
          ? previewLines.map((line) =>
            renderLine(
              line.content,
              `${agent.config.agentId}-${line.absoluteIndex}`,
            ))
          : (
            <Text color={colors.text.muted}>
              {agent.status === "active" ? "Initializing\u2026" : "Waiting for work\u2026"}
            </Text>
          )}
      </Box>
      {agent.status === "active" ? (
        <Box marginTop={1}>
          <Text color={colors.text.muted}>
            {titlePrefix === "Master" ? "Coordinating\u2026" : "Working\u2026"}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

const AgentFrame = React.memo(
  AgentFrameComponent,
  (previousProps, nextProps) => (
    previousProps.agent === nextProps.agent &&
    previousProps.output === nextProps.output &&
    previousProps.titlePrefix === nextProps.titlePrefix &&
    previousProps.isFocused === nextProps.isFocused &&
    previousProps.maxLines === nextProps.maxLines
  ),
);

export function SplitPanel({
  agents,
  activeAgentIndex,
  onSelectAgent,
  agentOutputs,
}: ISplitPanelProps): React.ReactElement {
  useInput((input, key) => {
    if (key.tab) {
      onSelectAgent((activeAgentIndex + 1) % agents.length);
      return;
    }

    const numericKey = Number.parseInt(input, 10);
    if (
      !Number.isNaN(numericKey) &&
      numericKey >= 1 &&
      numericKey <= agents.length &&
      key.ctrl
    ) {
      onSelectAgent(numericKey - 1);
    }
  });

  const [masterAgent, ...workerAgents] = agents;
  const focusedAgent = agents[activeAgentIndex];

  if (!masterAgent) {
    return (
      <Box flexGrow={1} borderStyle="round" borderColor={colors.border.dim} paddingX={1}>
        <Text color={colors.text.muted}>No agents active</Text>
      </Box>
    );
  }

  const masterOutput = agentOutputs.get(masterAgent.config.agentId) ?? "";

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text color={colors.text.muted}>Focus: </Text>
        <Text color={colors.status.active} bold>
          {focusedAgent?.config.name ?? masterAgent.config.name}
        </Text>
        <Text color={colors.text.muted}>  </Text>
        <Text color={colors.status.active} bold>Tab</Text>
        <Text color={colors.text.muted}> cycle  </Text>
        <Text color={colors.status.active} bold>Ctrl+1</Text>
        <Text color={colors.text.muted}>-</Text>
        <Text color={colors.status.active} bold>{agents.length}</Text>
        <Text color={colors.text.muted}> jump  </Text>
        <Text color={colors.status.warning} bold>/team stop</Text>
        <Text color={colors.text.muted}> exit swarm</Text>
      </Box>

      <Box flexGrow={1}>
        <Box flexBasis="50%" flexDirection="column" paddingRight={1}>
          <AgentFrame
            agent={masterAgent}
            output={masterOutput}
            titlePrefix="Master"
            isFocused={activeAgentIndex === 0}
            maxLines={28}
          />
        </Box>

        <Box flexBasis="50%" flexDirection="column" paddingLeft={1}>
          {workerAgents.length > 0 ? (
            workerAgents.map((agent, index) => (
              <AgentFrame
                key={agent.config.agentId}
                agent={agent}
                output={agentOutputs.get(agent.config.agentId) ?? ""}
                titlePrefix="Worker"
                isFocused={activeAgentIndex === index + 1}
                maxLines={8}
              />
            ))
          ) : (
            <Box borderStyle="single" borderColor={colors.border.dim} paddingX={1}>
              <Text color={colors.text.muted}>No worker agents in this swarm.</Text>
            </Box>
          )}
        </Box>
      </Box>

      <Box marginTop={0}>
        <Text color={colors.text.muted}>
          Input is sent to the focused agent. The master agent remains pinned to the left pane.
        </Text>
      </Box>
    </Box>
  );
}
