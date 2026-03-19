import { describe, expect, it } from "vitest";
import { navigateHistoryState } from "../../src/ui/history-navigation.js";

describe("navigateHistoryState", () => {
  it("returns to the blank draft after recalling the newest history item", () => {
    const recalled = navigateHistoryState(
      {
        history: ["/help", "/model"],
        historyIndex: -1,
        previousHistoryIndex: undefined,
        cache: {},
        currentInput: "",
        currentCursorOffset: 0,
      },
      0,
      "end",
    );

    expect(recalled.historyIndex).toBe(0);
    expect(recalled.input).toBe("/model");
    expect(recalled.cursorOffset).toBe("/model".length);

    const restored = navigateHistoryState(
      {
        history: ["/help", "/model"],
        historyIndex: recalled.historyIndex,
        previousHistoryIndex: recalled.previousHistoryIndex,
        cache: recalled.cache,
        currentInput: recalled.input,
        currentCursorOffset: recalled.cursorOffset,
      },
      -1,
      "end",
    );

    expect(restored.historyIndex).toBe(-1);
    expect(restored.input).toBe("");
    expect(restored.cursorOffset).toBe(0);
  });

  it("restores the draft cursor when returning from history", () => {
    const recalled = navigateHistoryState(
      {
        history: ["deploy release"],
        historyIndex: -1,
        previousHistoryIndex: undefined,
        cache: {},
        currentInput: "draft change",
        currentCursorOffset: 5,
      },
      0,
      "end",
    );

    const restored = navigateHistoryState(
      {
        history: ["deploy release"],
        historyIndex: recalled.historyIndex,
        previousHistoryIndex: recalled.previousHistoryIndex,
        cache: recalled.cache,
        currentInput: recalled.input,
        currentCursorOffset: recalled.cursorOffset,
      },
      -1,
      "end",
    );

    expect(restored.input).toBe("draft change");
    expect(restored.cursorOffset).toBe(5);
  });
});
