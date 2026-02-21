/**
 * User input component with autocomplete per PRD section 6.2
 * Triggers: / (slash commands), @ (context refs), ` (code refs)
 * Shows first 5 matches, arrow keys to navigate, Enter to select
 * Supports input history (up/down arrows) and Escape to cancel streaming
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { AutocompletePopup } from "./AutocompletePopup.js";
import {
  getAutocompleteItems,
  type AutocompleteTrigger,
  type IAutocompleteItem,
} from "../autocomplete-data.js";

interface IInputBarProps {
  readonly onSubmit: (input: string) => void;
  readonly isProcessing: boolean;
  readonly placeholder?: string;
  readonly onCancel?: (() => void) | undefined;
}

const TRIGGER_CHARS = new Set<string>(["/", "@", "`", "$"]);

/**
 * Detect if the input has an active autocomplete trigger.
 * A trigger is active when:
 *   - The first character is a trigger (for / at start of input)
 *   - A trigger character appears after a space (for @ and ` mid-input)
 *
 * Returns the trigger char and the query text after it, or null.
 */
function detectTrigger(input: string): { trigger: AutocompleteTrigger; query: string } | null {
  if (input.length === 0) {
    return null;
  }

  // Check for / at start of input (slash commands)
  if (input[0] === "/") {
    return { trigger: "/", query: input };
  }

  // Check for $ at start of input (skill invocation)
  if (input[0] === "$") {
    return { trigger: "$", query: input };
  }

  // Check for @ or ` — find the last trigger character
  for (let i = input.length - 1; i >= 0; i--) {
    const ch = input[i];
    if (ch === undefined) continue;

    if (TRIGGER_CHARS.has(ch) && ch !== "/" && ch !== "$") {
      // Trigger must be at start or preceded by a space
      if (i === 0 || input[i - 1] === " ") {
        return {
          trigger: ch as AutocompleteTrigger,
          query: input.slice(i),
        };
      }
    }

    // Stop searching if we hit a space before finding a trigger
    if (ch === " ") {
      break;
    }
  }

  return null;
}

const MAX_HISTORY = 100;

export function InputBar({ onSubmit, isProcessing, placeholder, onCancel }: IInputBarProps): React.ReactElement {
  const [input, setInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState("");

  // Compute autocomplete state from current input
  const triggerState = useMemo(() => detectTrigger(input), [input]);

  const autocompleteItems: readonly IAutocompleteItem[] = useMemo(() => {
    if (triggerState === null) return [];
    return getAutocompleteItems(triggerState.trigger, triggerState.query);
  }, [triggerState]);

  const isAutocompleteActive = autocompleteItems.length > 0;

  useInput((inputChar, key) => {
    // During processing, only allow Escape to cancel
    if (isProcessing) {
      if (key.escape && onCancel) {
        onCancel();
      }
      return;
    }

    // ── Autocomplete Navigation ─────────────────────────────────────
    if (isAutocompleteActive) {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : autocompleteItems.length - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((prev) => (prev < autocompleteItems.length - 1 ? prev + 1 : 0));
        return;
      }

      // Tab to accept the selected completion
      if (key.tab) {
        const selected = autocompleteItems[selectedIndex];
        if (selected && triggerState) {
          const beforeTrigger = input.slice(0, input.length - triggerState.query.length);
          const newInput = beforeTrigger + selected.label + " ";
          setInput(newInput);
          setSelectedIndex(0);
        }
        return;
      }

      // Escape to dismiss autocomplete
      if (key.escape) {
        setInput((prev) => prev + " ");
        setSelectedIndex(0);
        return;
      }
    }

    // ── Input History Navigation ────────────────────────────────────
    if (key.upArrow) {
      if (history.length === 0) return;
      if (historyIndex === -1) {
        setSavedInput(input);
      }
      const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInput(history[newIndex] ?? "");
      return;
    }

    if (key.downArrow) {
      if (historyIndex === -1) return;
      const newIndex = historyIndex + 1;
      if (newIndex >= history.length) {
        setHistoryIndex(-1);
        setInput(savedInput);
      } else {
        setHistoryIndex(newIndex);
        setInput(history[newIndex] ?? "");
      }
      return;
    }

    // ── Standard Input Handling ─────────────────────────────────────
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

    if (key.ctrl && inputChar === "c") {
      process.exit(0);
      return;
    }

    if (key.ctrl && inputChar === "l") {
      return;
    }

    if (!key.ctrl && !key.meta && inputChar) {
      setInput((prev) => prev + inputChar);
      setSelectedIndex(0);
      setHistoryIndex(-1);
    }
  });

  return (
    <Box flexDirection="column">
      {isAutocompleteActive ? <AutocompletePopup items={autocompleteItems} selectedIndex={selectedIndex} /> : null}
      <Box borderStyle="single" borderColor={isProcessing ? "gray" : "green"} paddingX={1}>
        <Text color="green" bold>
          {">"}{" "}
        </Text>
        {isProcessing ? (
          <Text color="gray">{onCancel ? "Esc to cancel" : "Processing..."}</Text>
        ) : input.length > 0 ? (
          <Text>{input}</Text>
        ) : (
          <Text color="gray">{placeholder ?? "Type a message..."}</Text>
        )}
        {!isProcessing ? <Text color="green">_</Text> : null}
      </Box>
    </Box>
  );
}
