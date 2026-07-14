// Semantic color conventions across the renderers: cyan for the filled progress
// bar and spinner; bold for tag headers; green for the success message; red for
// failed entries; yellow for blocked entries; dim for the unfilled bar, deploy
// lines, verb/arrow, and unchanged counts.
function ansi(code: string, s: string): string {
  return `\x1b[${code}m${s}\x1b[0m`;
}

export function makeStyle(isTTY: boolean) {
  return {
    bold: (s: string) => (isTTY ? ansi('1', s) : s),
    dim: (s: string) => (isTTY ? ansi('2', s) : s),
    cyan: (s: string) => (isTTY ? ansi('96', s) : s),
    yellow: (s: string) => (isTTY ? ansi('33', s) : s),
    green: (s: string) => (isTTY ? ansi('32', s) : s),
    red: (s: string) => (isTTY ? ansi('31', s) : s),
  };
}

export type Style = ReturnType<typeof makeStyle>;

/**
 * Whether stdout is a TTY. Resolved once at the command boundary and threaded
 * into renderers, which take `isTTY` as a required argument rather than each
 * reaching for ambient process state.
 */
export function resolveIsTTY(): boolean {
  return process.stdout.isTTY === true;
}
