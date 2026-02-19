/**
 * Model interaction hook per PRD section 6.2
 * Manages the active model resolution and provider access
 */

import { useState, useCallback, useMemo } from "react";
import type { ModelRole, IModelResolution, IGlobalConfig } from "../../types/index.js";
import { createModelRouter } from "../../core/index.js";
import type { ModelRouter } from "../../core/index.js";

interface IUseModelReturn {
  readonly resolution: IModelResolution;
  readonly modelId: string;
  readonly switchModel: (modelId: string) => void;
  readonly switchRole: (role: ModelRole) => void;
  readonly router: ModelRouter;
}

export function useModel(
  config: IGlobalConfig,
  initialModel?: string,
  initialRole?: ModelRole,
): IUseModelReturn {
  const router = useMemo(() => createModelRouter(config), [config]);

  const [userOverride, setUserOverride] = useState<string | undefined>(initialModel);
  const [currentRole, setCurrentRole] = useState<ModelRole | undefined>(initialRole);

  if (userOverride) {
    router.setUserOverride(userOverride);
  }

  const resolution = useMemo(
    () => router.resolve(currentRole),
    [router, currentRole, userOverride],
  );

  const switchModel = useCallback(
    (modelId: string) => {
      router.setUserOverride(modelId);
      setUserOverride(modelId);
    },
    [router],
  );

  const switchRole = useCallback((role: ModelRole) => {
    setCurrentRole(role);
    setUserOverride(undefined);
  }, []);

  return {
    resolution,
    modelId: resolution.modelId,
    switchModel,
    switchRole,
    router,
  };
}
