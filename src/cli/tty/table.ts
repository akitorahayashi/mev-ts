import type { Style } from './style';

export interface Column {
  readonly header: string;
  /** Applied to each non-final column's padded cell (identity when omitted). */
  readonly style?: (cell: string) => string;
}

const ESCAPE = '\u001b';

/**
 * Printable width, skipping the SGR sequences a caller may have applied. The
 * final column's cells arrive already styled, so measuring their raw length
 * would count invisible bytes and overshoot that column by the size of every
 * escape sequence in it.
 */
function visibleWidth(text: string): number {
  let width = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] === ESCAPE && text[index + 1] === '[') {
      const end = text.indexOf('m', index + 2);
      if (end !== -1) {
        index = end + 1;
        continue;
      }
    }
    width += 1;
    index += 1;
  }
  return width;
}

/**
 * Render aligned columns as a header row, a dim separator, and body rows (no
 * surrounding blank lines — the caller frames the block). Every column but the
 * last is padded to its widest cell and styled; the final column is appended
 * verbatim so a caller whose last cell varies in color styles it itself — but
 * its separator still spans the widest cell, matching every other column, so
 * only the padding, not the underline, stops at the last column. Widths are
 * measured on printable width, so a pre-styled cell does not widen its column
 * by the length of its escape sequences.
 */
export function renderTable(
  style: Style,
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
): string {
  const last = columns.length - 1;
  const widths = columns.map((column, index) =>
    Math.max(
      visibleWidth(column.header),
      ...rows.map((row) => visibleWidth(row[index] ?? '')),
    ),
  );
  const pad = (text: string, width: number) =>
    text + ' '.repeat(width - visibleWidth(text) + 1);
  const framed = (text: string, index: number): string =>
    index === last ? text : pad(text, widths[index] ?? 0);

  const header = ` ${columns
    .map((column, index) => style.bold(framed(column.header, index)))
    .join('')}`;
  const separator = ` ${columns
    .map((_column, index) => {
      const width = widths[index] ?? 0;
      const rule = '─'.repeat(width);
      return style.dim(index === last ? rule : pad(rule, width));
    })
    .join('')}`;
  const body = rows.map(
    (row) =>
      ` ${columns
        .map((column, index) => {
          const value = framed(row[index] ?? '', index);
          if (index === last) return value;
          return (column.style ?? ((cell) => cell))(value);
        })
        .join('')}`,
  );

  return `${header}\n${separator}\n${body.join('\n')}`;
}
