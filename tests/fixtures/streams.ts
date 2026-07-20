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
