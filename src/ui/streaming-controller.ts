/**
 * Newline-gated streaming controller.
 *
 * Buffers incoming text chunks and only commits complete lines
 * (terminated by `\n`) to the viewport. This prevents mid-word
 * and mid-line reflows during streaming output in the terminal.
 */

/** A single committed (complete) line of streamed text. */
export interface ICommittedLine {
  readonly text: string;
  readonly lineNumber: number;
}

/** Immutable snapshot of the streaming controller state. */
export interface IStreamingState {
  /** All committed (complete) lines so far. */
  readonly committedLines: readonly ICommittedLine[];
  /** The current partial line that hasn't received \n yet. */
  readonly pendingLine: string;
  /** Whether any lines have been committed (for header logic). */
  readonly hasEmittedHeader: boolean;
  /** Total committed line count. */
  readonly totalLines: number;
}

/**
 * Accumulates streamed text chunks and commits only complete lines.
 *
 * Partial lines are held in an internal buffer until a newline
 * character arrives, eliminating mid-word terminal reflows.
 */
export class StreamingController {
  private buffer: string;
  private committed: ICommittedLine[];
  private lineCounter: number;
  private headerEmitted: boolean;
  /** Index into `committed` marking where the last drain ended. */
  private drainCursor: number;

  constructor() {
    this.buffer = "";
    this.committed = [];
    this.lineCounter = 0;
    this.headerEmitted = false;
    this.drainCursor = 0;
  }

  /**
   * Feed a text chunk into the controller.
   *
   * Lines terminated by `\n` are committed immediately.
   * Any trailing text without a newline stays in the buffer.
   *
   * @returns Newly committed lines from this chunk.
   */
  push(chunk: string): readonly ICommittedLine[] {
    this.buffer += chunk;
    const newLines: ICommittedLine[] = [];

    let newlineIdx = this.buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const lineText = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);

      this.lineCounter += 1;
      const committed: ICommittedLine = {
        text: lineText,
        lineNumber: this.lineCounter,
      };
      this.committed.push(committed);
      newLines.push(committed);

      newlineIdx = this.buffer.indexOf("\n");
    }

    if (newLines.length > 0) {
      this.headerEmitted = true;
    }

    return newLines;
  }

  /**
   * Flush the remaining buffer as a final committed line.
   *
   * Call this when the stream ends to commit any trailing
   * partial line that never received a terminating newline.
   *
   * @returns The flushed line, or `null` if the buffer was empty.
   */
  flush(): ICommittedLine | null {
    if (this.buffer.length === 0) {
      return null;
    }

    this.lineCounter += 1;
    const committed: ICommittedLine = {
      text: this.buffer,
      lineNumber: this.lineCounter,
    };
    this.committed.push(committed);
    this.buffer = "";
    this.headerEmitted = true;

    return committed;
  }

  /** Get an immutable snapshot of the current controller state. */
  getState(): IStreamingState {
    return {
      committedLines: [...this.committed],
      pendingLine: this.buffer,
      hasEmittedHeader: this.headerEmitted,
      totalLines: this.lineCounter,
    };
  }

  /** Get only the pending (incomplete) line text. */
  getPendingLine(): string {
    return this.buffer;
  }

  /** Reset the controller to its initial state. */
  reset(): void {
    this.buffer = "";
    this.committed = [];
    this.lineCounter = 0;
    this.headerEmitted = false;
    this.drainCursor = 0;
  }

  /**
   * Get committed lines since the last call to this method.
   *
   * Useful for incremental rendering — each call returns only
   * the lines that were committed after the previous drain.
   */
  drainNewLines(): readonly ICommittedLine[] {
    const newLines = this.committed.slice(this.drainCursor);
    this.drainCursor = this.committed.length;
    return newLines;
  }
}

/** Factory function to create a new StreamingController instance. */
export function createStreamingController(): StreamingController {
  return new StreamingController();
}
