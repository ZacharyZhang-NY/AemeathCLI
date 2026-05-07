import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SinglePane } from "./layouts/SinglePane.js";
import type { InputMode } from "./components/InputBar.js";
import { useSession } from "./hooks/useSession.js";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AemeathConfig, ModelRole } from "../config/schema.js";

interface AppProps {
  session: AgentSession;
  config: AemeathConfig;
  initialMessage?: string | undefined;
  role?: ModelRole | undefined;
}

export function App({ session, config, initialMessage, role }: AppProps): React.ReactElement {
  const sessionView = useSession(session);
  const [gitBranch, setGitBranch] = useState<string | undefined>(undefined);
  const [inputMode, setInputMode] = useState<InputMode>("chat");
  const model = session.model?.id ?? config.roles[role ?? config.defaultRole].primary;

  useEffect(() => {
    void import("node:child_process")
      .then(({ execFile }) => {
        execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 2000 }, (error, stdout) => {
          if (!error && stdout) {
            setGitBranch(stdout.trim());
          }
        });
      })
      .catch(() => {});
  }, []);

  const handleSubmit = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        return;
      }

      void session.prompt(trimmed).catch(() => {
        // session events surface the failure into the transcript; nothing else to do here
      });
    },
    [session],
  );

  const handleCancel = useCallback(() => {
    void session.abort();
  }, [session]);

  useEffect(() => {
    if (!initialMessage || initialMessage.trim().length === 0) {
      return;
    }

    void session.prompt(initialMessage).catch(() => {
      // surfaced through session events
    });
  }, [initialMessage, session]);

  const cost = useMemo(() => sessionView.cost, [sessionView.cost]);
  const tokenCount = useMemo(() => sessionView.tokenCount, [sessionView.tokenCount]);

  return (
    <SinglePane
      messages={sessionView.messages}
      isProcessing={sessionView.isProcessing}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      model={model}
      role={role ?? config.defaultRole}
      tokenCount={tokenCount}
      cost={cost}
      gitBranch={gitBranch}
      streamingContent={sessionView.streamingContent}
      activity={sessionView.activity}
      mode={inputMode}
      onModeChange={setInputMode}
    />
  );
}

export default App;
