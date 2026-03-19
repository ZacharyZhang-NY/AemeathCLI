/**
 * Panel management hook per PRD section 9
 */

import {
  startTransition,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import type { IAgentState, AgentStatus } from "../../types/index.js";

interface IUsePanelReturn {
  readonly agents: readonly IAgentState[];
  readonly activeAgentIndex: number;
  readonly agentOutputs: ReadonlyMap<string, string>;
  readonly isSplitPanelActive: boolean;
  readonly selectAgent: (index: number) => void;
  readonly appendOutput: (
    agentId: string,
    content: string,
    options?: { readonly immediate?: boolean },
  ) => void;
  readonly updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  readonly setAgents: (agents: readonly IAgentState[]) => void;
  readonly activate: () => void;
  readonly deactivate: () => void;
}

export function usePanel(): IUsePanelReturn {
  const flushIntervalMs = 100;
  const [agents, setAgentsState] = useState<readonly IAgentState[]>([]);
  const [activeAgentIndex, setActiveAgentIndex] = useState(0);
  const [agentOutputs, setAgentOutputs] = useState<Map<string, string>>(new Map());
  const [isSplitPanelActive, setIsSplitPanelActive] = useState(false);
  const pendingOutputRef = useRef<Map<string, string>>(new Map());
  const flushTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const flushPendingOutput = useCallback(() => {
    flushTimerRef.current = undefined;

    if (pendingOutputRef.current.size === 0) {
      return;
    }

    const pending = pendingOutputRef.current;
    pendingOutputRef.current = new Map();

    startTransition(() => {
      setAgentOutputs((prev) => {
        const next = new Map(prev);
        for (const [agentId, content] of pending.entries()) {
          const existing = next.get(agentId) ?? "";
          next.set(agentId, existing + content);
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== undefined) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  const selectAgent = useCallback((index: number) => {
    setActiveAgentIndex(index);
  }, []);

  const appendOutput = useCallback((
    agentId: string,
    content: string,
    options?: { readonly immediate?: boolean },
  ) => {
    const pending = pendingOutputRef.current;
    pending.set(agentId, (pending.get(agentId) ?? "") + content);

    if (options?.immediate === true) {
      if (flushTimerRef.current !== undefined) {
        clearTimeout(flushTimerRef.current);
      }
      flushPendingOutput();
      return;
    }

    if (flushTimerRef.current === undefined) {
      flushTimerRef.current = setTimeout(flushPendingOutput, flushIntervalMs);
    }
  }, [flushIntervalMs, flushPendingOutput]);

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
    setActiveAgentIndex(0);
  }, []);

  const activate = useCallback(() => {
    setIsSplitPanelActive(true);
  }, []);

  const deactivate = useCallback(() => {
    if (flushTimerRef.current !== undefined) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = undefined;
    }
    pendingOutputRef.current = new Map();
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
