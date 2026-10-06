import { errorMessage, ProvisioningError } from '../errors';

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  /** Overrides inherited environment variables; unspecified variables remain inherited. */
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly stdout?: 'pipe' | 'inherit';
  readonly stderr?: 'pipe' | 'inherit';
  readonly timeoutMs?: number;
}

export interface CommandRunner {
  /**
   * Runs a command to completion and resolves with its result. A spawn failure
   * does not reject: a missing or otherwise unspawnable executable resolves as
   * `code 127` (the shell command-not-found convention) with the failure reason
   * in `stderr`. An elapsed timeout terminates the owned process group and
   * resolves as code 124 with captured output and the timeout in stderr.
   * Test fakes must follow the same contract.
   */
  run(
    command: string,
    args: readonly string[],
    options?: CommandOptions,
  ): Promise<CommandResult>;
}

function commandFailureDetail(
  result: CommandResult,
  fallback = 'unknown error',
): string {
  const stderr = result.stderr.trim();
  if (stderr) return stderr;
  const stdout = result.stdout.trim();
  if (stdout) return stdout;
  return fallback;
}

export function formatCommandFailure(
  failure: string,
  result: CommandResult,
  fallback = 'unknown error',
): string {
  return `${failure} with code ${result.code}: ${commandFailureDetail(result, fallback)}`;
}

export const bunCommandRunner: CommandRunner = {
  async run(command, args, options): Promise<CommandResult> {
    const timeoutMs = options?.timeoutMs;
    if (
      timeoutMs !== undefined &&
      (!Number.isInteger(timeoutMs) ||
        timeoutMs <= 0 ||
        timeoutMs > 2_147_483_647)
    ) {
      throw new ProvisioningError(
        'Command timeout must be an integer between 1 and 2147483647 milliseconds.',
      );
    }
    const stdoutMode = options?.stdout ?? 'pipe';
    const stderrMode = options?.stderr ?? 'pipe';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const subprocess = Bun.spawn([command, ...args], {
        stdout: stdoutMode,
        stderr: stderrMode,
        cwd: options?.cwd,
        env: { ...Bun.env, ...options?.env },
        detached: timeoutMs !== undefined,
      });
      const termination = Promise.withResolvers<never>();
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          timedOut = true;
          try {
            // Git or SSH descendants can hold output pipes after the CLI exits.
            process.kill(-subprocess.pid, 'SIGKILL');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
              termination.reject(error);
            }
          }
        }, timeoutMs);
      }
      const completion = Promise.all([
        stdoutMode === 'pipe' && subprocess.stdout
          ? new Response(subprocess.stdout).text()
          : Promise.resolve(''),
        stderrMode === 'pipe' && subprocess.stderr
          ? new Response(subprocess.stderr).text()
          : Promise.resolve(''),
        subprocess.exited,
      ]);
      const [stdout, stderr, code] = await Promise.race([
        completion,
        termination.promise,
      ]);
      if (timedOut) {
        return {
          code: 124,
          stdout,
          stderr: [stderr.trimEnd(), `Command timed out after ${timeoutMs}ms.`]
            .filter(Boolean)
            .join('\n'),
        };
      }
      return { code, stdout, stderr };
    } catch (error) {
      // A missing or unspawnable executable surfaces as code 127 with the reason
      // in stderr rather than a rejected promise, so callers treat it as a normal
      // command failure.
      return {
        code: timedOut ? 124 : 127,
        stdout: '',
        stderr: timedOut
          ? `Command timed out after ${timeoutMs}ms; process-group termination failed: ${errorMessage(error)}`
          : errorMessage(error),
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
