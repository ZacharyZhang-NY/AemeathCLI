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

  const resolution = useMemo(
    () => {
      router.setUserOverride(userOverride);
      return router.resolve(currentRole);
    },
    [router, currentRole, userOverride],
  );

  const switchModel = useCallback((modelId: string) => {
    setUserOverride(modelId);
  }, []);

  const switchRole = useCallback(
    (role: ModelRole) => {
      router.setUserOverride(undefined);
      setCurrentRole(role);
      setUserOverride(undefined);
    },
    [router],
  );

  return {
    resolution,
    modelId: resolution.modelId,
    switchModel,
    switchRole,
    router,
  };
}
