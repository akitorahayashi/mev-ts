import { errorMessage } from '../errors';

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  /** Extra variables layered over the inherited environment. */
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly stdout?: 'pipe' | 'inherit';
  readonly stderr?: 'pipe' | 'inherit';
}

export interface CommandRunner {
  /**
   * Runs a command to completion and resolves with its result. A spawn failure
   * does not reject: a missing or otherwise unspawnable executable resolves as
   * `code 127` (the shell command-not-found convention) with the failure reason
   * in `stderr`. Test fakes must follow the same contract.
   */
  run(
    command: string,
    args: readonly string[],
    options?: CommandOptions,
  ): Promise<CommandResult>;
}

export function commandFailureDetail(
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

/** Runs external commands through Bun's process spawner. */
export const bunCommandRunner: CommandRunner = {
  async run(command, args, options): Promise<CommandResult> {
    const stdoutMode = options?.stdout ?? 'pipe';
    const stderrMode = options?.stderr ?? 'pipe';
    try {
      const process = Bun.spawn([command, ...args], {
        stdout: stdoutMode,
        stderr: stderrMode,
        cwd: options?.cwd,
        env: options?.env ? { ...Bun.env, ...options.env } : undefined,
      });
      const [stdout, stderr, code] = await Promise.all([
        stdoutMode === 'pipe' && process.stdout
          ? new Response(process.stdout).text()
          : Promise.resolve(''),
        stderrMode === 'pipe' && process.stderr
          ? new Response(process.stderr).text()
          : Promise.resolve(''),
        process.exited,
      ]);
      return { code, stdout, stderr };
    } catch (error) {
      // A missing or unspawnable executable surfaces as code 127 with the reason
      // in stderr rather than a rejected promise, so callers treat it as a normal
      // command failure.
      return {
        code: 127,
        stdout: '',
        stderr: errorMessage(error),
      };
    }
  },
};
