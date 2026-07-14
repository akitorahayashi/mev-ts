import type { Style } from './style';

export interface Column {
  readonly header: string;
  /** Applied to each non-final column's padded cell (identity when omitted). */
  readonly style?: (cell: string) => string;
}

/**
 * Render aligned columns as a header row, a dim separator, and body rows (no
 * surrounding blank lines — the caller frames the block). Every column but the
 * last is padded to its widest raw cell and styled; the final column is appended
 * verbatim so a caller whose last cell varies in color styles it itself. Column
 * widths are measured on the raw cell text passed in.
 */
export function renderTable(
  style: Style,
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
): string {
  const last = columns.length - 1;
  const widths = columns.map((column, index) =>
    Math.max(
      column.header.length,
      ...rows.map((row) => (row[index] ?? '').length),
    ),
  );
  const pad = (text: string, width: number) =>
    text + ' '.repeat(width - text.length + 1);
  const framed = (text: string, index: number): string =>
    index === last ? text : pad(text, widths[index] ?? 0);

  const header = ` ${columns
    .map((column, index) => style.bold(framed(column.header, index)))
    .join('')}`;
  const separator = ` ${columns
    .map((column, index) =>
      style.dim(
        index === last
          ? '─'.repeat(column.header.length)
          : pad('─'.repeat(widths[index] ?? 0), widths[index] ?? 0),
      ),
    )
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
