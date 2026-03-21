/**
 * User input component with autocomplete, history, animated cursor,
 * and Shift+Tab mode cycling (agent swarm / accept edits / chat).
 */

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { AutocompletePopup } from "./AutocompletePopup.js";
import { BRAND_COLOR, colors } from "../theme.js";
import {
  getAutocompleteItems,
  type AutocompleteTrigger,
  type IAutocompleteItem,
} from "../autocomplete-data.js";
import {
  backspaceAtCursor,
  clampCursorOffset,
  codePointLength,
  deleteAtCursor,
  insertTextAtCursor,
  sliceCodePoints,
} from "../input-utils.js";
import { navigateHistoryState } from "../history-navigation.js";

// ── Mode system ─────────────────────────────────────────────────────────

export type InputMode = "agent-swarm" | "accept-edits" | "chat";

const MODE_ORDER: readonly InputMode[] = ["agent-swarm", "accept-edits", "chat"];

interface IModeDisplay {
  readonly label: string;
  readonly icon: string;
  readonly color: string;
}

const MODE_DISPLAY: Record<InputMode, IModeDisplay> = {
  "agent-swarm": {
    label: "swarm orchestrator",
    icon: "\u25B6\u25B6",
    color: BRAND_COLOR,
  },
  "accept-edits": {
    label: "guided edits",
    icon: "\u2551\u2551",
    color: "#EDD6DC",
  },
  chat: {
    label: "direct chat",
    icon: "\u25CB",
    color: "#8D7176",
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

interface ITriggerMatch {
  readonly trigger: AutocompleteTrigger;
  readonly query: string;
  readonly rangeStart: number;
}

function detectTrigger(
  input: string,
  cursorOffset: number,
): ITriggerMatch | null {
  const safeOffset = clampCursorOffset(input, cursorOffset);
  const beforeCursor = sliceCodePoints(input, 0, safeOffset);
  if (beforeCursor.length === 0) return null;
  if (beforeCursor[0] === "/") return { trigger: "/", query: beforeCursor, rangeStart: 0 };
  if (beforeCursor[0] === "$") return { trigger: "$", query: beforeCursor, rangeStart: 0 };

  const points = Array.from(beforeCursor);
  for (let i = points.length - 1; i >= 0; i--) {
    const ch = points[i];
    if (ch === undefined) continue;
    if (TRIGGER_CHARS.has(ch) && ch !== "/" && ch !== "$") {
      if (i === 0 || points[i - 1] === " ") {
        return {
          trigger: ch as AutocompleteTrigger,
          query: points.slice(i).join(""),
          rangeStart: i,
        };
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
  const [cursorOffset, setCursorOffset] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [history, setHistory] = useState<string[]>(
    initialHistory ? [...initialHistory] : [],
  );
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef(input);
  const cursorOffsetRef = useRef(cursorOffset);
  const historyRef = useRef(history);
  const historyIndexRef = useRef(historyIndex);
  const triggerStateRef = useRef<ITriggerMatch | null>(null);
  const autocompleteItemsRef = useRef<readonly IAutocompleteItem[]>([]);
  const isAutocompleteActiveRef = useRef(false);
  const previousHistoryIndexRef = useRef<number | undefined>(undefined);
  const historyCacheRef = useRef<Record<number, { text: string; cursorOffset: number }>>({});

  // ── Paste detection refs ──────────────────────────────────
  const lastInputTimeRef = useRef(0);
  const pasteBufferRef = useRef('');
  const pasteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPastingRef = useRef(false);

  const setInputWithCursor = useCallback(
    (nextInput: string, cursorPosition: "start" | "end" | number = "end") => {
      const nextCursor = cursorPosition === "start"
        ? 0
        : cursorPosition === "end"
          ? codePointLength(nextInput)
          : clampCursorOffset(nextInput, cursorPosition);
      inputRef.current = nextInput;
      cursorOffsetRef.current = nextCursor;
      setInput(nextInput);
      setCursorOffset(nextCursor);
      setSelectedIndex(0);
    },
    [],
  );

  const setCursorPosition = useCallback(
    (nextCursor: number) => {
      const clamped = clampCursorOffset(inputRef.current, nextCursor);
      cursorOffsetRef.current = clamped;
      setCursorOffset(clamped);
    },
    [],
  );

  const resetHistoryNavigation = useCallback(() => {
    historyIndexRef.current = -1;
    setHistoryIndex(-1);
    previousHistoryIndexRef.current = undefined;
    historyCacheRef.current = {};
  }, []);

  const navigateHistory = useCallback(
    (nextIndex: number, defaultCursor: "start" | "end") => {
      const result = navigateHistoryState(
        {
          history: historyRef.current,
          historyIndex: historyIndexRef.current,
          previousHistoryIndex: previousHistoryIndexRef.current,
          cache: historyCacheRef.current,
          currentInput: inputRef.current,
          currentCursorOffset: cursorOffsetRef.current,
        },
        nextIndex,
        defaultCursor,
      );

      historyCacheRef.current = result.cache;
      historyIndexRef.current = result.historyIndex;
      previousHistoryIndexRef.current = result.previousHistoryIndex;
      setHistoryIndex(result.historyIndex);
      setInputWithCursor(result.input, result.cursorOffset);
    },
    [setInputWithCursor],
  );

  const applyAutocompleteSelection = useCallback(
    (selected: IAutocompleteItem, triggerMatch: ITriggerMatch) => {
      const currentInput = inputRef.current;
      const currentCursorOffset = cursorOffsetRef.current;
      const before = sliceCodePoints(currentInput, 0, triggerMatch.rangeStart);
      const after = sliceCodePoints(currentInput, currentCursorOffset);
      const nextInput = `${before}${selected.label} ${after}`;
      setInputWithCursor(nextInput, codePointLength(before) + codePointLength(selected.label) + 1);
    },
    [setInputWithCursor],
  );

  // Sync when initialHistory arrives async (after first render)
  useEffect(() => {
    if (initialHistory && initialHistory.length > 0) {
      setHistory((prev) => {
        if (prev.length === 0) return [...initialHistory];
        return prev;
      });
    }
  }, [initialHistory]);

  // ── Bracketed paste mode ──────────────────────────────────
  // Enable bracketed paste on mount so the terminal wraps pasted text
  // in escape sequences, preventing individual char handler triggers.
  useEffect(() => {
    process.stdout.write('\x1b[?2004h');
    return () => {
      process.stdout.write('\x1b[?2004l');
    };
  }, []);

  // Clean up paste timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (pasteTimeoutRef.current) clearTimeout(pasteTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    inputRef.current = input;
    cursorOffsetRef.current = cursorOffset;
    historyRef.current = history;
    historyIndexRef.current = historyIndex;
  }, [cursorOffset, history, historyIndex, input]);

  const triggerState = useMemo(() => detectTrigger(input, cursorOffset), [cursorOffset, input]);
  const autocompleteItems: readonly IAutocompleteItem[] = useMemo(() => {
    if (triggerState === null) return [];
    return getAutocompleteItems(triggerState.trigger, triggerState.query);
  }, [triggerState]);
  const isAutocompleteActive = autocompleteItems.length > 0;

  useEffect(() => {
    triggerStateRef.current = triggerState;
    autocompleteItemsRef.current = autocompleteItems;
    isAutocompleteActiveRef.current = isAutocompleteActive;
  }, [autocompleteItems, isAutocompleteActive, triggerState]);

  const appendToHistory = useCallback((entry: string) => {
    setHistory((prev) => {
      const next = [...prev.slice(-(MAX_HISTORY - 1)), entry];
      historyRef.current = next;
      return next;
    });
  }, []);

  useInput((inputChar, key) => {
    const currentInput = inputRef.current;
    const currentCursorOffset = cursorOffsetRef.current;
    const currentHistoryIndex = historyIndexRef.current;
    const currentHistory = historyRef.current;
    const currentTriggerState = triggerStateRef.current;
    const currentAutocompleteItems = autocompleteItemsRef.current;
    const currentAutocompleteActive = isAutocompleteActiveRef.current;

    if (isProcessing) {
      if (key.escape && onCancel) {
        onCancel();
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPosition(currentCursorOffset - 1);
      return;
    }

    if (key.rightArrow) {
      setCursorPosition(currentCursorOffset + 1);
      return;
    }

    // ── Shift+Tab: cycle mode ───────────────────────────────
    if (key.tab && key.shift) {
      if (onModeChange) {
        const idx = MODE_ORDER.indexOf(mode);
        const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
        if (next) {
          onModeChange(next);
        }
      }
      return;
    }

    // ── History Navigation ──────────────────────────────────
    if (key.upArrow) {
      if (currentHistoryIndex !== -1) {
        if (currentHistoryIndex < currentHistory.length - 1) {
          navigateHistory(currentHistoryIndex + 1, "end");
        }
        return;
      }
      if (currentAutocompleteActive) {
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : currentAutocompleteItems.length - 1,
        );
        return;
      }
      if (currentHistory.length > 0) {
        navigateHistory(0, "end");
      }
      return;
    }

    if (key.downArrow) {
      if (currentHistoryIndex !== -1) {
        navigateHistory(currentHistoryIndex - 1, "end");
        return;
      }
      if (currentAutocompleteActive) {
        setSelectedIndex((prev) =>
          prev < currentAutocompleteItems.length - 1 ? prev + 1 : 0,
        );
      }
      return;
    }

    // ── Autocomplete Actions ────────────────────────────────
    if (currentAutocompleteActive) {
      if (key.tab) {
        const selected = currentAutocompleteItems[selectedIndex];
        if (selected && currentTriggerState) {
          applyAutocompleteSelection(selected, currentTriggerState);
        }
        return;
      }
      if (key.escape) {
        const result = insertTextAtCursor(currentInput, currentCursorOffset, " ");
        setInputWithCursor(result.text, result.cursorOffset);
        return;
      }
    }

    // ── Submit ──────────────────────────────────────────────
    if (key.return) {
      if (currentHistoryIndex !== -1 && currentInput.trim().length > 0) {
        appendToHistory(currentInput.trim());
        onSubmit(currentInput.trim());
        setInputWithCursor("");
        resetHistoryNavigation();
        return;
      }

      if (currentAutocompleteActive) {
        const selected = currentAutocompleteItems[selectedIndex];
        if (selected && currentTriggerState) {
          if (currentTriggerState.trigger === "/" && currentHistoryIndex === -1) {
            appendToHistory(selected.label.trim());
            onSubmit(selected.label.trim());
            setInputWithCursor("");
          } else {
            applyAutocompleteSelection(selected, currentTriggerState);
          }
          resetHistoryNavigation();
          return;
        }
      }
      if (currentInput.trim().length > 0) {
        appendToHistory(currentInput.trim());
        onSubmit(currentInput.trim());
        setInputWithCursor("");
        resetHistoryNavigation();
      }
      return;
    }

    // Backward delete (backspace): remove character before cursor.
    // On macOS, the keyboard Delete key sends \x7f which Ink 5.x maps to
    // key.delete (not key.backspace). Both must trigger backward-delete so
    // the user can erase text normally. Ctrl+H is the classic fallback.
    if (key.backspace || key.delete || (key.ctrl && inputChar === "h")) {
      const result = backspaceAtCursor(currentInput, currentCursorOffset);
      setInputWithCursor(result.text, result.cursorOffset);
      return;
    }

    // Forward delete: Ctrl+D removes the character at/after the cursor.
    if (key.ctrl && inputChar === "d" && currentInput.length > 0) {
      const result = deleteAtCursor(currentInput, currentCursorOffset);
      setInputWithCursor(result.text, result.cursorOffset);
      return;
    }

    if (key.ctrl && inputChar === "c") { process.exit(0); return; }
    if (key.ctrl && inputChar === "l") return;

    // ── Paste burst detection ──────────────────────────────
    // If multiple characters arrive within 5ms, treat as a paste rather
    // than individual keystrokes. Accumulate into a buffer and flush
    // once the burst stops, so autocomplete isn't triggered per-char.
    if (!key.ctrl && !key.meta && inputChar) {
      const now = Date.now();
      const timeSinceLastInput = now - lastInputTimeRef.current;
      lastInputTimeRef.current = now;

      if (timeSinceLastInput < 5) {
        // Paste burst detected
        isPastingRef.current = true;
        pasteBufferRef.current += inputChar;

        if (pasteTimeoutRef.current) clearTimeout(pasteTimeoutRef.current);
        pasteTimeoutRef.current = setTimeout(() => {
          // Flush paste buffer
          const pasteText = pasteBufferRef.current;
          pasteBufferRef.current = '';
          isPastingRef.current = false;
          if (pasteText) {
            const result = insertTextAtCursor(inputRef.current, cursorOffsetRef.current, pasteText);
            setInputWithCursor(result.text, result.cursorOffset);
          }
        }, 10);
        return; // Don't process individual chars during paste
      }

      // Normal single-character typing
      const result = insertTextAtCursor(currentInput, currentCursorOffset, inputChar);
      setInputWithCursor(result.text, result.cursorOffset);
    }
  });

  const modeInfo = MODE_DISPLAY[mode];
  const borderColor = isProcessing ? colors.border.dim : modeInfo.color;
  const cursorChar = sliceCodePoints(input, cursorOffset, cursorOffset + 1);
  const beforeCursor = sliceCodePoints(input, 0, cursorOffset);
  const afterCursor = cursorChar.length > 0
    ? sliceCodePoints(input, cursorOffset + 1)
    : "";

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
            <Text color={colors.text.primary}>{beforeCursor}</Text>
            {cursorChar.length > 0 ? (
              <Text color={colors.text.primary} inverse>{cursorChar}</Text>
            ) : (
              <Text color={modeInfo.color}>{"\u2588"}</Text>
            )}
            {afterCursor.length > 0 ? (
              <Text color={colors.text.primary}>{afterCursor}</Text>
            ) : null}
          </Text>
        ) : (
          <Text color={colors.text.muted}>
            {placeholder ?? "Type a message\u2026"}
            <Text color={modeInfo.color}>{"\u2588"}</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}
