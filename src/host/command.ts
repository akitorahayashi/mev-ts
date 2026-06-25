export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  /** Extra variables layered over the inherited environment. */
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
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
    const process = Bun.spawn([command, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options?.cwd,
      env: options?.env ? { ...Bun.env, ...options.env } : undefined,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    return { code, stdout, stderr };
  },
};
