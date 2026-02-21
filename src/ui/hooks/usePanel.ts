/**
 * Panel management hook per PRD section 9
 */

import { useState, useCallback, useMemo } from "react";
import type { IAgentState, AgentStatus } from "../../types/index.js";

interface IUsePanelReturn {
  readonly agents: readonly IAgentState[];
  readonly activeAgentIndex: number;
  readonly agentOutputs: ReadonlyMap<string, string>;
  readonly isSplitPanelActive: boolean;
  readonly selectAgent: (index: number) => void;
  readonly appendOutput: (agentId: string, content: string) => void;
  readonly updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  readonly setAgents: (agents: readonly IAgentState[]) => void;
  readonly activate: () => void;
  readonly deactivate: () => void;
}

export function usePanel(): IUsePanelReturn {
  const [agents, setAgentsState] = useState<readonly IAgentState[]>([]);
  const [activeAgentIndex, setActiveAgentIndex] = useState(0);
  const [agentOutputs, setAgentOutputs] = useState<Map<string, string>>(new Map());
  const [isSplitPanelActive, setIsSplitPanelActive] = useState(false);

  const selectAgent = useCallback((index: number) => {
    setActiveAgentIndex(index);
  }, []);

  const appendOutput = useCallback((agentId: string, content: string) => {
    setAgentOutputs((prev) => {
      const next = new Map(prev);
      const existing = next.get(agentId) ?? "";
      next.set(agentId, existing + content);
      return next;
    });
  }, []);

  const updateAgentStatus = useCallback((agentId: string, status: AgentStatus) => {
    setAgentsState((prev) =>
      prev.map((agent) =>
        agent.config.agentId === agentId
          ? { ...agent, status }
          : agent,
      ),
    );
  }, []);

  const setAgents = useCallback((newAgents: readonly IAgentState[]) => {
    setAgentsState(newAgents);
  }, []);

  const activate = useCallback(() => {
    setIsSplitPanelActive(true);
  }, []);

  const deactivate = useCallback(() => {
    setIsSplitPanelActive(false);
    setAgentsState([]);
    setAgentOutputs(new Map());
    setActiveAgentIndex(0);
  }, []);

  return useMemo(() => ({
    agents,
    activeAgentIndex,
    agentOutputs,
    isSplitPanelActive,
    selectAgent,
    appendOutput,
    updateAgentStatus,
    setAgents,
    activate,
    deactivate,
  }), [agents, activeAgentIndex, agentOutputs, isSplitPanelActive, selectAgent, appendOutput, updateAgentStatus, setAgents, activate, deactivate]);
}
