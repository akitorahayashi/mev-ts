/** A stdout/stderr pair that buffers writes for assertion in CLI tests. */
export interface CapturedStreams {
  readonly stdout: { write(chunk: unknown): boolean };
  readonly stderr: { write(chunk: unknown): boolean };
  stdoutText(): string;
  stderrText(): string;
}

/**
 * Capture stdout and stderr into in-memory buffers. The writers satisfy the
 * minimal `{ write }` surface both `runCommandLine` options and a clipanion
 * `BaseContext` need; call sites cast to the exact stream type they require.
 */
export function captureStreams(): CapturedStreams {
  let out = '';
  let err = '';
  return {
    stdout: {
      write(chunk) {
        out += String(chunk);
        return true;
      },
    },
    stderr: {
      write(chunk) {
        err += String(chunk);
        return true;
      },
    },
    stdoutText: () => out,
    stderrText: () => err,
  };
}

/** A fake terminal stream for exercising the animated (TTY) progress path. */
export interface FakeTtyStream {
  readonly isTTY: true;
  readonly columns: number;
  write(chunk: unknown): boolean;
  output(): string;
}

/**
 * A writable that reports itself as a TTY and buffers everything written, so the
 * animated progress renderers (spinner + bar) can be driven and asserted without
 * the real process stdout.
 */
export function fakeTtyStream(columns = 80): FakeTtyStream {
  let out = '';
  return {
    isTTY: true,
    columns,
    write(chunk) {
      out += String(chunk);
      return true;
    },
    output: () => out,
  };
}
