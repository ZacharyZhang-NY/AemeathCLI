/**
 * Multi-model split panel layout for team mode per PRD section 9.5 (fallback)
 * When tmux is not available, this provides tab-based agent switching
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
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

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Tab bar */}
      <Box>
        {agents.map((agent, index) => {
          const isActive = index === activeAgentIndex;
          const statusColor = getStatusColor(agent.status);
          return (
            <Box
              key={agent.config.agentId}
              borderStyle={isActive ? "bold" : "single"}
              borderColor={isActive ? "cyan" : "gray"}
              paddingX={1}
              marginRight={1}
            >
              <Text color={statusColor} bold={isActive}>
                {agent.config.name}
              </Text>
              <Text color="gray" dimColor>
                {" "}
                ({agent.config.model})
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Active agent output */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        {activeAgent ? (
          <>
            <Text color="cyan" bold>
              {activeAgent.config.name} — {activeAgent.config.role}
            </Text>
            <Text wrap="wrap">{activeOutput}</Text>
          </>
        ) : (
          <Text color="gray">No agents active</Text>
        )}
      </Box>
    </Box>
  );
}
