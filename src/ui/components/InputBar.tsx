/**
 * User input component with autocomplete, history, animated cursor,
 * and Shift+Tab mode cycling (agent swarm / accept edits / chat).
 */

import React, { useState, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { AutocompletePopup } from "./AutocompletePopup.js";
import { BRAND_COLOR, colors } from "../theme.js";
import {
  getAutocompleteItems,
  type AutocompleteTrigger,
  type IAutocompleteItem,
} from "../autocomplete-data.js";

// ── Mode system ─────────────────────────────────────────────────────────

export type InputMode = "agent-swarm" | "accept-edits" | "chat";

const MODE_ORDER: readonly InputMode[] = ["agent-swarm", "accept-edits", "chat"];

interface IModeDisplay {
  readonly label: string;
  readonly icon: string;
  readonly color: string;
  readonly description: string;
}

const MODE_DISPLAY: Record<InputMode, IModeDisplay> = {
  "agent-swarm": {
    label: "agent swarm on",
    icon: "\u25B6\u25B6",
    color: BRAND_COLOR,
    description: "bypass permissions",
  },
  "accept-edits": {
    label: "accept edits",
    icon: "\u2551\u2551",
    color: "#EDD6DC",
    description: "confirm before changes",
  },
  chat: {
    label: "chat mode",
    icon: "\u25CB",
    color: "#8D7176",
    description: "conversation only",
  },
};

// ── Props ───────────────────────────────────────────────────────────────

interface IInputBarProps {
  readonly onSubmit: (input: string) => void;
  readonly isProcessing: boolean;
  readonly placeholder?: string | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly initialHistory?: readonly string[] | undefined;
  /** Current mode — controlled by parent. */
  readonly mode?: InputMode | undefined;
  /** Called when user presses Shift+Tab to cycle mode. */
  readonly onModeChange?: ((mode: InputMode) => void) | undefined;
}

// ── Trigger detection ───────────────────────────────────────────────────

const TRIGGER_CHARS = new Set<string>(["/", "@", "`", "$"]);

function detectTrigger(
  input: string,
): { trigger: AutocompleteTrigger; query: string } | null {
  if (input.length === 0) return null;
  if (input[0] === "/") return { trigger: "/", query: input };
  if (input[0] === "$") return { trigger: "$", query: input };

  for (let i = input.length - 1; i >= 0; i--) {
    const ch = input[i];
    if (ch === undefined) continue;
    if (TRIGGER_CHARS.has(ch) && ch !== "/" && ch !== "$") {
      if (i === 0 || input[i - 1] === " ") {
        return { trigger: ch as AutocompleteTrigger, query: input.slice(i) };
      }
    }
    if (ch === " ") break;
  }
  return null;
}

const MAX_HISTORY = 100;

// ── Component ───────────────────────────────────────────────────────────

export function InputBar({
  onSubmit,
  isProcessing,
  placeholder,
  onCancel,
  initialHistory,
  mode = "agent-swarm",
  onModeChange,
}: IInputBarProps): React.ReactElement {
  const [input, setInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [history, setHistory] = useState<string[]>(
    initialHistory ? [...initialHistory] : [],
  );
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState("");

  // Sync when initialHistory arrives async (after first render)
  useEffect(() => {
    if (initialHistory && initialHistory.length > 0) {
      setHistory((prev) => {
        if (prev.length === 0) return [...initialHistory];
        return prev;
      });
    }
  }, [initialHistory]);

  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    if (isProcessing) return;
    const timer = setInterval(() => setCursorVisible((p) => !p), 530);
    return () => clearInterval(timer);
  }, [isProcessing]);

  const triggerState = useMemo(() => detectTrigger(input), [input]);
  const autocompleteItems: readonly IAutocompleteItem[] = useMemo(() => {
    if (triggerState === null) return [];
    return getAutocompleteItems(triggerState.trigger, triggerState.query);
  }, [triggerState]);
  const isAutocompleteActive = autocompleteItems.length > 0;

  useInput((inputChar, key) => {
    if (isProcessing) {
      if (key.escape && onCancel) onCancel();
      return;
    }

    // ── Shift+Tab: cycle mode ───────────────────────────────
    if (key.tab && key.shift) {
      if (onModeChange) {
        const idx = MODE_ORDER.indexOf(mode);
        const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length]!;
        onModeChange(next);
      }
      return;
    }

    // ── Autocomplete Navigation ─────────────────────────────
    if (isAutocompleteActive) {
      if (key.upArrow) {
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : autocompleteItems.length - 1,
        );
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) =>
          prev < autocompleteItems.length - 1 ? prev + 1 : 0,
        );
        return;
      }
      if (key.tab) {
        const selected = autocompleteItems[selectedIndex];
        if (selected && triggerState) {
          const before = input.slice(0, input.length - triggerState.query.length);
          setInput(before + selected.label + " ");
          setSelectedIndex(0);
        }
        return;
      }
      if (key.escape) {
        setInput((prev) => prev + " ");
        setSelectedIndex(0);
        return;
      }
    }

    // ── History Navigation ──────────────────────────────────
    if (key.upArrow) {
      if (history.length === 0) return;
      if (historyIndex === -1) setSavedInput(input);
      const newIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIdx);
      setInput(history[newIdx] ?? "");
      return;
    }
    if (key.downArrow) {
      if (historyIndex === -1) return;
      const newIdx = historyIndex + 1;
      if (newIdx >= history.length) {
        setHistoryIndex(-1);
        setInput(savedInput);
      } else {
        setHistoryIndex(newIdx);
        setInput(history[newIdx] ?? "");
      }
      return;
    }

    // ── Submit ──────────────────────────────────────────────
    if (key.return) {
      if (isAutocompleteActive && triggerState?.trigger === "/") {
        const selected = autocompleteItems[selectedIndex];
        if (selected) {
          setHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), selected.label.trim()]);
          onSubmit(selected.label.trim());
          setInput("");
          setSelectedIndex(0);
          setHistoryIndex(-1);
          return;
        }
      }
      if (input.trim().length > 0) {
        setHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), input.trim()]);
        onSubmit(input.trim());
        setInput("");
        setSelectedIndex(0);
        setHistoryIndex(-1);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      setSelectedIndex(0);
      setHistoryIndex(-1);
      return;
    }

    if (key.ctrl && inputChar === "c") { process.exit(0); return; }
    if (key.ctrl && inputChar === "l") return;

    if (!key.ctrl && !key.meta && inputChar) {
      setInput((prev) => prev + inputChar);
      setSelectedIndex(0);
      setHistoryIndex(-1);
    }
  });

  const modeInfo = MODE_DISPLAY[mode];
  const borderColor = isProcessing ? colors.border.dim : modeInfo.color;

  return (
    <Box flexDirection="column">
      {isAutocompleteActive ? (
        <AutocompletePopup items={autocompleteItems} selectedIndex={selectedIndex} />
      ) : null}

      {/* Mode indicator bar */}
      <Box>
        <Text color={colors.border.dim}>{"\u2500".repeat(4)} </Text>
        <Text color={modeInfo.color} bold>{modeInfo.icon} </Text>
        <Text color={modeInfo.color} bold>{modeInfo.label}</Text>
        <Text color={colors.text.muted}> (shift+tab to cycle)</Text>
      </Box>

      {/* Input box */}
      <Box borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text color={modeInfo.color} bold>
          {"\u276F"}{" "}
        </Text>
        {isProcessing ? (
          <Text color={colors.text.muted}>
            {onCancel ? "esc to cancel" : "Processing\u2026"}
          </Text>
        ) : input.length > 0 ? (
          <Text>
            <Text color={colors.text.primary}>{input}</Text>
            <Text color={modeInfo.color}>{cursorVisible ? "\u2588" : " "}</Text>
          </Text>
        ) : (
          <Text color={colors.text.muted}>
            {placeholder ?? "Type a message\u2026"}
            <Text color={modeInfo.color}>{cursorVisible ? "\u2588" : " "}</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}
