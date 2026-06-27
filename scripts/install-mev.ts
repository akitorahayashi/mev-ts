import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

async function run(command: string, args: readonly string[]): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${code}`,
    );
  }
}

await run(Bun.argv[0], ['run', 'build']);

const installDir = join(homedir(), '.local', 'bin');

await mkdir(installDir, { recursive: true });
await copyFile('dist/mev', join(installDir, 'mev'));
await chmod(join(installDir, 'mev'), 0o755);

console.log(`Installed to ${join(installDir, 'mev')}`);
