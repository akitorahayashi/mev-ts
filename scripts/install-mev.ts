import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { errorMessage } from '../src/errors';

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
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
  const projectRoot = join(import.meta.dir, '..');
  await run(Bun.argv[0] as string, ['run', 'build'], projectRoot);

  // The build and artifact are project-relative, so this script works from any
  // caller directory.
  const artifact = join(projectRoot, 'dist', 'mev');
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
