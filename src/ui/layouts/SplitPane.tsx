/**
 * Split-pane team layout per PRD section 9.5 (in-process fallback)
 */

import React from "react";
import { Box } from "ink";
import { SplitPanel } from "../components/SplitPanel.js";
import { InputBar } from "../components/InputBar.js";
import { StatusBar } from "../components/StatusBar.js";
import type { IAgentState } from "../../types/index.js";

interface ISplitPaneProps {
  readonly agents: readonly IAgentState[];
  readonly activeAgentIndex: number;
  readonly onSelectAgent: (index: number) => void;
  readonly agentOutputs: ReadonlyMap<string, string>;
  readonly isProcessing: boolean;
  readonly onSubmit: (input: string) => void;
  readonly onCancel?: (() => void) | undefined;
  readonly model: string;
  readonly role?: string | undefined;
  readonly tokenCount: string;
  readonly cost: string;
  readonly gitBranch?: string | undefined;
}

export function SplitPane({
  agents,
  activeAgentIndex,
  onSelectAgent,
  agentOutputs,
  isProcessing,
  onSubmit,
  onCancel,
  model,
  role,
  tokenCount,
  cost,
  gitBranch,
}: ISplitPaneProps): React.ReactElement {
  return (
    <Box flexDirection="column" height="100%">
      <StatusBar model={model} role={role} tokenCount={tokenCount} cost={cost} gitBranch={gitBranch} />
      <SplitPanel
        agents={agents}
        activeAgentIndex={activeAgentIndex}
        onSelectAgent={onSelectAgent}
        agentOutputs={agentOutputs}
      />
      <InputBar onSubmit={onSubmit} isProcessing={isProcessing} onCancel={onCancel} />
    </Box>
  );
}
