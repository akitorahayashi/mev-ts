import { chmod, copyFile, mkdir } from 'node:fs/promises';
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

await run('bun', ['run', 'build']);

const home = Bun.env.HOME;
if (!home) {
  throw new Error('HOME is required to install mev');
}
const installDir = join(home, '.local', 'bin');

await mkdir(installDir, { recursive: true });
await copyFile('dist/mev', join(installDir, 'mev'));
await chmod(join(installDir, 'mev'), 0o755);

console.log(`Installed to ${join(installDir, 'mev')}`);
