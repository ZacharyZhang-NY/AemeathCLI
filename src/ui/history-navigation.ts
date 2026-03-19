import { clampCursorOffset, codePointLength } from "./input-utils.js";

export interface IHistorySnapshot {
  readonly text: string;
  readonly cursorOffset: number;
}

export interface IHistoryNavigationState {
  readonly history: readonly string[];
  readonly historyIndex: number;
  readonly previousHistoryIndex: number | undefined;
  readonly cache: Readonly<Record<number, IHistorySnapshot>>;
  readonly currentInput: string;
  readonly currentCursorOffset: number;
}

export interface IHistoryNavigationResult {
  readonly historyIndex: number;
  readonly previousHistoryIndex: number;
  readonly cache: Record<number, IHistorySnapshot>;
  readonly input: string;
  readonly cursorOffset: number;
}

export function navigateHistoryState(
  state: IHistoryNavigationState,
  nextIndex: number,
  defaultCursor: "start" | "end",
): IHistoryNavigationResult {
  const cache = { ...state.cache };
  const previousIndex = state.historyIndex;

  cache[previousIndex] = {
    text: state.currentInput,
    cursorOffset: clampCursorOffset(state.currentInput, state.currentCursorOffset),
  };

  const saved = cache[nextIndex];
  const isReturningToPrevious =
    nextIndex === -1 || nextIndex === state.previousHistoryIndex;

  if (
    isReturningToPrevious &&
    saved &&
    saved.cursorOffset > 0 &&
    saved.cursorOffset < codePointLength(saved.text)
  ) {
    return {
      historyIndex: nextIndex,
      previousHistoryIndex: previousIndex,
      cache,
      input: saved.text,
      cursorOffset: saved.cursorOffset,
    };
  }

  if (nextIndex === -1) {
    const text = saved?.text ?? "";
    return {
      historyIndex: nextIndex,
      previousHistoryIndex: previousIndex,
      cache,
      input: text,
      cursorOffset: defaultCursor === "start" ? 0 : codePointLength(text),
    };
  }

  if (saved) {
    return {
      historyIndex: nextIndex,
      previousHistoryIndex: previousIndex,
      cache,
      input: saved.text,
      cursorOffset: defaultCursor === "start" ? 0 : codePointLength(saved.text),
    };
  }

  const input = state.history[state.history.length - 1 - nextIndex] ?? "";
  return {
    historyIndex: nextIndex,
    previousHistoryIndex: previousIndex,
    cache,
    input,
    cursorOffset: defaultCursor === "start" ? 0 : codePointLength(input),
  };
}
