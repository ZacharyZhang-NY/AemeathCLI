/**
 * Cost tracking hook per PRD section 7.5
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { ICostConfig, ProviderName, ModelRole } from "../../types/index.js";
import { CostTracker, getEventBus } from "../../core/index.js";
import { formatCost, formatTokenCount } from "../../utils/index.js";

interface IUseCostReturn {
  readonly totalCost: string;
  readonly totalTokens: string;
  readonly isBudgetExceeded: boolean;
  readonly record: (
    provider: ProviderName,
    model: string,
    inputTokens: number,
    outputTokens: number,
    role?: ModelRole,
  ) => void;
  readonly tracker: CostTracker;
}

export function useCost(config: ICostConfig): IUseCostReturn {
  const trackerRef = useRef(new CostTracker(config));
  const [totalCost, setTotalCost] = useState("$0.00");
  const [totalTokens, setTotalTokens] = useState("0");
  const [isBudgetExceeded, setIsBudgetExceeded] = useState(false);

  useEffect(() => {
    const eventBus = getEventBus();

    const unsubCost = eventBus.on("cost:updated", ({ total }) => {
      setTotalCost(formatCost(total));
      const tokens = trackerRef.current.getSessionTokens();
      setTotalTokens(formatTokenCount(tokens.total));
    });

    const unsubExceeded = eventBus.on("cost:exceeded", () => {
      setIsBudgetExceeded(true);
    });

    return () => {
      unsubCost();
      unsubExceeded();
    };
  }, []);

  const record = useCallback(
    (
      provider: ProviderName,
      model: string,
      inputTokens: number,
      outputTokens: number,
      role?: ModelRole,
    ) => {
      trackerRef.current.record(provider, model, inputTokens, outputTokens, role);
    },
    [],
  );

  return {
    totalCost,
    totalTokens,
    isBudgetExceeded,
    record,
    tracker: trackerRef.current,
  };
}
