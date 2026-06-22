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
