import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { errorMessage } from '../src/errors';

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

async function install(): Promise<void> {
  await run(Bun.argv[0] as string, ['run', 'build']);

  // Resolve the artifact from the script location, not the cwd, so `bun run up`
  // works from any directory.
  const artifact = join(import.meta.dir, '..', 'dist', 'mev');
  if (!(await Bun.file(artifact).exists())) {
    throw new Error(
      `Build artifact not found at ${artifact}. The build did not produce dist/mev.`,
    );
  }

  // Honor MEV_INSTALL_DIR to match install.sh; default to ~/.local/bin.
  const installDir =
    process.env.MEV_INSTALL_DIR ?? join(homedir(), '.local', 'bin');
  await mkdir(installDir, { recursive: true });
  const dest = join(installDir, 'mev');
  await copyFile(artifact, dest);
  await chmod(dest, 0o755);

  console.log(`Installed to ${dest}`);
}

try {
  await install();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
