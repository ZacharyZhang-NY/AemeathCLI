/**
 * Multi-model split panel layout for team mode per PRD section 9.5 (fallback)
 * When tmux is not available, this provides tab-based agent switching
 * with color-coded streaming output, tool call highlighting, and activity status
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { Spinner } from "./Spinner.js";
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
      return "green";
    case "idle":
      return "yellow";
    case "error":
      return "red";
    case "shutdown":
      return "gray";
    default:
      return "white";
  }
}

/** Short model label for the tab bar (e.g. "claude-opus-4-6" → "Opus") */
function shortModelLabel(model: string): string {
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("gpt-5")) return "GPT-5";
  if (model.includes("gemini") && model.includes("pro")) return "Gem-Pro";
  if (model.includes("gemini") && model.includes("flash")) return "Gem-Flash";
  if (model.includes("kimi") || model.includes("k2")) return "Kimi";
  // Fallback: last segment
  const parts = model.split("-");
  return parts[parts.length - 1] ?? model.slice(0, 8);
}

/** Status indicator character */
function statusIndicator(status: string): string {
  switch (status) {
    case "active": return "\u25CF"; // ●
    case "idle": return "\u25CB";   // ○
    case "error": return "\u2716";  // ✖
    default: return "\u2500";       // ─
  }
}

const MAX_OUTPUT_LINES = 40;

/** Classify a line of agent output for color coding. */
function classifyLine(line: string): "tool" | "result" | "error" | "text" | "empty" {
  if (line.length === 0) return "empty";
  if (line.startsWith("\u2699") || line.startsWith("⚙")) return "tool";
  if (line.startsWith("  \u2192") || line.startsWith("  →")) return "result";
  if (line.startsWith("Error:") || line.startsWith("Stream error:")) return "error";
  return "text";
}

/** Extract the last meaningful activity line from output (for status display). */
function extractLastActivity(output: string): string | undefined {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    const type = classifyLine(line);
    if (type === "tool") return line;
    if (type === "result") return line;
  }
  return undefined;
}

/** Render agent output with color-coded lines and line truncation. */
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
        <Text color="gray" dimColor>  ({lines.length - MAX_OUTPUT_LINES} lines hidden)</Text>
      ) : null}
      {visible.map((line, i) => {
        const type = classifyLine(line);
        switch (type) {
          case "tool":
            return <Text key={i} color="magenta">{line}</Text>;
          case "result":
            return <Text key={i} color="gray">{line}</Text>;
          case "error":
            return <Text key={i} color="red" bold>{line}</Text>;
          case "empty":
            return <Text key={i}>{" "}</Text>;
          default:
            return <Text key={i} wrap="wrap">{line}</Text>;
        }
      })}
      {isActive ? (
        <Box marginTop={0}>
          <Spinner label="Working..." />
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
    // Tab to switch between agents
    if (key.tab) {
      const nextIndex = (activeAgentIndex + 1) % agents.length;
      onSelectAgent(nextIndex);
    }
    // Number keys 1-9 to select agent directly
    const numKey = parseInt(input, 10);
    if (!isNaN(numKey) && numKey >= 1 && numKey <= agents.length && key.ctrl) {
      onSelectAgent(numKey - 1);
    }
  });

  const activeAgent = agents[activeAgentIndex];
  const activeOutput = activeAgent
    ? agentOutputs.get(activeAgent.config.agentId) ?? ""
    : "";
  const lastActivity = activeOutput.length > 0 ? extractLastActivity(activeOutput) : undefined;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Tab bar */}
      <Box>
        {agents.map((agent, index) => {
          const isActive = index === activeAgentIndex;
          const sColor = getStatusColor(agent.status);
          const indicator = statusIndicator(agent.status);
          const modelShort = shortModelLabel(agent.config.model);
          // Capitalize agentType for tab label
          const typeLabel = agent.config.agentType.charAt(0).toUpperCase() + agent.config.agentType.slice(1);
          return (
            <Box
              key={agent.config.agentId}
              borderStyle={isActive ? "bold" : "single"}
              borderColor={isActive ? "cyan" : "gray"}
              paddingX={1}
            >
              <Text color={sColor}>{indicator} </Text>
              <Text bold={isActive}>{typeLabel}</Text>
              <Text color="gray" dimColor> {modelShort}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Hint line */}
      <Box>
        <Text color="gray" dimColor>  Tab: switch agent | Ctrl+1-{agents.length}: jump | /team stop: exit</Text>
      </Box>

      {/* Active agent output */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1} borderStyle="round" borderColor="gray">
        {activeAgent ? (
          <>
            {/* Agent header with name, role, status, and last activity */}
            <Box>
              <Text color="cyan" bold>
                {"\u2726"} {activeAgent.config.name}
              </Text>
              <Text color="gray"> {"\u2014"} {activeAgent.config.role} </Text>
              <Text color={getStatusColor(activeAgent.status)}>
                [{activeAgent.status}]
              </Text>
            </Box>
            {lastActivity ? (
              <Box>
                <Text color="gray" dimColor>  {lastActivity.length > 80 ? lastActivity.slice(0, 80) + "..." : lastActivity}</Text>
              </Box>
            ) : null}
            <Box borderStyle="single" borderColor="gray" borderTop borderBottom={false} borderLeft={false} borderRight={false} marginY={0} />

            {/* Output area with color-coded lines and spinner */}
            {activeOutput.length > 0 ? (
              <Box flexDirection="column" marginTop={0}>
                <AgentOutput output={activeOutput} isActive={activeAgent.status === "active"} />
              </Box>
            ) : activeAgent.status === "active" ? (
              <Box marginTop={1}>
                <Spinner label="Initializing agent..." />
              </Box>
            ) : (
              <Text color="yellow">
                {"\u231B"} Waiting for task...
              </Text>
            )}
          </>
        ) : (
          <Text color="gray">No agents active</Text>
        )}
      </Box>
    </Box>
  );
}
