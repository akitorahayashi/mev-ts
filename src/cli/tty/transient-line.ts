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
  /** Clear the current line back to empty at column 0. */
  clear(): void;
}

// Carriage return to column 0, then erase the entire line.
const RESET_LINE = '\r\x1b[2K';

export function createTransientLine(
  stream: Writable & { columns?: number },
): TransientLine {
  return {
    render(text) {
      // Clamp to the terminal width so the line never soft-wraps: RESET_LINE
      // erases only the physical row the cursor is on, so a wrapped first row
      // would be orphaned on screen. Read columns per render to track resizes.
      const width = stream.columns;
      const clamped =
        width !== undefined && text.length >= width
          ? `${text.slice(0, Math.max(0, width - 2))}…`
          : text;
      stream.write(`${RESET_LINE}${clamped}`);
    },
    clear() {
      stream.write(RESET_LINE);
    },
  };
}
