import { chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { errorMessage } from '../src/errors';
import { runWithCleanup } from '../src/host/cleanup-error';
import {
  type BuildInvocation,
  type BuildStdio,
  buildBundle,
  runBunBuild,
} from './build-bundle';

interface InstallOptions {
  readonly projectRoot: string;
  readonly installDir?: string;
  readonly stdio?: BuildStdio;
  readonly runBuildCommand?: (invocation: BuildInvocation) => Promise<number>;
}

function defaultInstallDir(): string {
  return process.env['MEV_INSTALL_DIR'] ?? join(homedir(), '.local', 'bin');
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
      // A Bun-targeted single-file JavaScript bundle, not a compiled binary.
      await buildBundle({
        projectRoot: options.projectRoot,
        outfile: stageDest,
        buildCwd: options.projectRoot,
        compile: false,
        target: 'bun',
        stdio: options.stdio ?? 'inherit',
        runCommand: options.runBuildCommand ?? runBunBuild,
      });

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
