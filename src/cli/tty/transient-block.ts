import type { Writable } from 'node:stream';

export interface TransientBlock {
  render(lines: readonly string[]): void;
  clear(): void;
}

export function createTransientBlock(
  stream: Writable & { columns?: number },
): TransientBlock {
  let rows = 0;

  const clear = () => {
    if (rows === 0) return;
    stream.write(`\r${rows > 1 ? `\x1b[${rows - 1}A` : ''}\x1b[0J`);
    rows = 0;
  };

  return {
    render(lines) {
      clear();
      const width = stream.columns;
      const clamped = lines.map((line) =>
        width !== undefined && line.length >= width
          ? `${line.slice(0, Math.max(0, width - 2))}…`
          : line,
      );
      stream.write(clamped.join('\n\r'));
      rows = clamped.length;
    },
    clear,
  };
}
