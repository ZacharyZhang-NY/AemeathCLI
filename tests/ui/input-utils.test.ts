import { describe, expect, it } from "vitest";
import {
  backspaceAtCursor,
  clampCursorOffset,
  codePointLength,
  deleteAtCursor,
  insertTextAtCursor,
  sliceCodePoints,
} from "../../src/ui/input-utils.js";

describe("input-utils", () => {
  it("inserts text at the current cursor offset", () => {
    expect(insertTextAtCursor("helo", 2, "l")).toEqual({
      text: "hello",
      cursorOffset: 3,
    });
  });

  it("backspaces the code point before the cursor", () => {
    expect(backspaceAtCursor("hello", 3)).toEqual({
      text: "helo",
      cursorOffset: 2,
    });
  });

  it("deletes the code point at the cursor", () => {
    expect(deleteAtCursor("hello", 1)).toEqual({
      text: "hllo",
      cursorOffset: 1,
    });
  });

  it("treats emoji as a single code point for cursor math", () => {
    expect(codePointLength("a🙂b")).toBe(3);
    expect(sliceCodePoints("a🙂b", 1, 2)).toBe("🙂");
    expect(insertTextAtCursor("ab", 1, "🙂")).toEqual({
      text: "a🙂b",
      cursorOffset: 2,
    });
  });

  it("clamps the cursor offset into the valid range", () => {
    expect(clampCursorOffset("abc", -3)).toBe(0);
    expect(clampCursorOffset("abc", 99)).toBe(3);
  });
});
