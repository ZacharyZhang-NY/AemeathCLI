export function toCodePoints(value: string): string[] {
  return Array.from(value);
}

export function codePointLength(value: string): number {
  return toCodePoints(value).length;
}

export function sliceCodePoints(value: string, start: number, end?: number): string {
  return toCodePoints(value).slice(start, end).join("");
}

export function clampCursorOffset(value: string, offset: number): number {
  return Math.max(0, Math.min(offset, codePointLength(value)));
}

export function codePointIndexToOffset(value: string, index: number): number {
  return sliceCodePoints(value, 0, index).length;
}

export function insertTextAtCursor(
  value: string,
  cursorOffset: number,
  insertedText: string,
): { text: string; cursorOffset: number } {
  const points = toCodePoints(value);
  const insertion = toCodePoints(insertedText);
  const safeOffset = clampCursorOffset(value, cursorOffset);
  points.splice(safeOffset, 0, ...insertion);
  return {
    text: points.join(""),
    cursorOffset: safeOffset + insertion.length,
  };
}

export function backspaceAtCursor(
  value: string,
  cursorOffset: number,
): { text: string; cursorOffset: number } {
  const safeOffset = clampCursorOffset(value, cursorOffset);
  if (safeOffset === 0) {
    return { text: value, cursorOffset: safeOffset };
  }

  const points = toCodePoints(value);
  points.splice(safeOffset - 1, 1);
  return {
    text: points.join(""),
    cursorOffset: safeOffset - 1,
  };
}

export function deleteAtCursor(
  value: string,
  cursorOffset: number,
): { text: string; cursorOffset: number } {
  const safeOffset = clampCursorOffset(value, cursorOffset);
  const points = toCodePoints(value);
  if (safeOffset >= points.length) {
    return { text: value, cursorOffset: safeOffset };
  }

  points.splice(safeOffset, 1);
  return {
    text: points.join(""),
    cursorOffset: safeOffset,
  };
}
