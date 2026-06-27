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
  run(
    command: string,
    args: readonly string[],
    options?: CommandOptions,
  ): Promise<CommandResult>;
}

/** Runs external commands through Bun's process spawner. */
export const bunCommandRunner: CommandRunner = {
  async run(command, args, options): Promise<CommandResult> {
    const stdoutMode = options?.stdout ?? 'pipe';
    const stderrMode = options?.stderr ?? 'pipe';
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
  },
};
