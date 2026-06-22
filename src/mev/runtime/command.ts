import type { CommandResult, CommandRunner } from '../resources/model';

/** Runs external commands through Bun's process spawner. */
export const bunCommandRunner: CommandRunner = {
  async run(command, args): Promise<CommandResult> {
    const process = Bun.spawn([command, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    return { code, stdout, stderr };
  },
};
