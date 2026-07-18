import { chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { errorMessage } from '../src/errors';
import { runWithCleanup } from '../src/host/cleanup-error';

type InstallStdio = 'inherit' | 'ignore';

interface InstallInvocation {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdio: InstallStdio;
}

interface InstallOptions {
  readonly projectRoot: string;
  readonly installDir?: string;
  readonly stdio?: InstallStdio;
  readonly runBuildCommand?: (invocation: InstallInvocation) => Promise<number>;
}

async function runBunBuild(invocation: InstallInvocation): Promise<number> {
  const proc = Bun.spawn(['bun', ...invocation.args], {
    cwd: invocation.cwd,
    stderr: invocation.stdio,
    stdout: invocation.stdio,
  });
  return proc.exited;
}

async function runBuildCommand(
  invocation: InstallInvocation,
  runCommand: (invocation: InstallInvocation) => Promise<number>,
  failureLabel: string,
): Promise<void> {
  const code = await runCommand(invocation);
  if (code !== 0) {
    throw new Error(`${failureLabel} failed with exit code ${code}`);
  }
}

function defaultInstallDir(): string {
  return process.env.MEV_INSTALL_DIR ?? join(homedir(), '.local', 'bin');
}

export async function installLocalMev(
  options: InstallOptions,
): Promise<string> {
  const installDir = options.installDir ?? defaultInstallDir();
  await mkdir(installDir, { recursive: true });
  const dest = join(installDir, 'mev');
  const stageDir = await mkdtemp(join(installDir, '.mev-up-'));
  const stageDest = join(stageDir, 'mev');

  await runWithCleanup(
    async () => {
      const runCommand = options.runBuildCommand ?? runBunBuild;
      const stdio = options.stdio ?? 'inherit';
      const projectRoot = options.projectRoot;

      await runBuildCommand(
        {
          args: [resolve(projectRoot, 'scripts/generate-assets.ts')],
          cwd: projectRoot,
          stdio,
        },
        runCommand,
        'asset codegen',
      );

      await runBuildCommand(
        {
          args: [
            'build',
            resolve(projectRoot, 'src/main.ts'),
            '--target',
            'bun',
            '--external',
            'chromium-bidi/*',
            '--outfile',
            stageDest,
          ],
          cwd: projectRoot,
          stdio,
        },
        runCommand,
        'bun build',
      );

      await chmod(stageDest, 0o755);
      await rename(stageDest, dest);
    },
    () => rm(stageDir, { force: true, recursive: true }),
    `Failed to clean up install workspace ${stageDir}.`,
  );

  return dest;
}

async function install(): Promise<void> {
  const projectRoot = join(import.meta.dir, '..');
  const dest = await installLocalMev({ projectRoot });

  console.log(`Installed to ${dest}`);
}

if (import.meta.main) {
  try {
    await install();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}
