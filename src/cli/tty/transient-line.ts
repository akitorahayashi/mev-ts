import type { Writable } from 'node:stream';

/**
 * One mutable terminal line rendered over an injected stream. Owns the cursor
 * handling (return to column 0, clear the line) shared by the animated progress
 * renderers, so it stays testable against any writable rather than reaching for
 * the real process streams.
 */
export interface TransientLine {
  /** Replace the current line with `text`, leaving the cursor on it. */
  render(text: string): void;
  /** Replace the current line with `text` and finalize it with a newline. */
  commit(text: string): void;
  /** Clear the current line back to empty at column 0. */
  clear(): void;
}

// Carriage return to column 0, then erase the entire line.
const RESET_LINE = '\r\x1b[2K';

export function createTransientLine(stream: Writable): TransientLine {
  return {
    render(text) {
      stream.write(`${RESET_LINE}${text}`);
    },
    commit(text) {
      stream.write(`${RESET_LINE}${text}\n`);
    },
    clear() {
      stream.write(RESET_LINE);
    },
  };
}
